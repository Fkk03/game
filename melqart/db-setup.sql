-- Melqart Research Tools — database setup (idempotent: safe to run repeatedly)
-- Run in Supabase SQL Editor. Creates one table per app + one private storage bucket.

-- ===== Expert tracker (Melqart Sentiment Tracker TEAM) =====
create table if not exists research_docs (
  id text primary key,
  created_at timestamptz default now(),
  uploaded_by text,
  doc_date date,
  doc_type text,
  filename text,
  title text,
  pdf_path text,
  data jsonb not null          -- full analysis document (see README data model)
);
alter table research_docs enable row level security;
drop policy if exists "team_select" on research_docs;
drop policy if exists "team_insert" on research_docs;
drop policy if exists "team_update" on research_docs;
drop policy if exists "team_delete" on research_docs;
create policy "team_select" on research_docs for select to anon using (true);
create policy "team_insert" on research_docs for insert to anon with check (true);
create policy "team_update" on research_docs for update to anon using (true);
create policy "team_delete" on research_docs for delete to anon using (true);

-- ===== Broker tracker (separate dataset, same shape) =====
create table if not exists broker_docs (
  id text primary key,
  created_at timestamptz default now(),
  uploaded_by text,
  doc_date date,
  doc_type text,
  filename text,
  title text,
  pdf_path text,
  data jsonb not null
);
alter table broker_docs enable row level security;
drop policy if exists "team_select" on broker_docs;
drop policy if exists "team_insert" on broker_docs;
drop policy if exists "team_update" on broker_docs;
drop policy if exists "team_delete" on broker_docs;
create policy "team_select" on broker_docs for select to anon using (true);
create policy "team_insert" on broker_docs for insert to anon with check (true);
create policy "team_update" on broker_docs for update to anon using (true);
create policy "team_delete" on broker_docs for delete to anon using (true);

-- ===== Earnings tracker (earnings-call transcripts; same shape) =====
-- data jsonb holds the full analysis: bullets, takeaway, detailed paragraph,
-- per-company sentiment scores with quotes, ranking, fiscal period + headline
-- numbers (see melqart/README.md data model). Originals go to the shared
-- 'calls' bucket under the earnings/ prefix, so no new storage policies needed.
create table if not exists earnings_docs (
  id text primary key,
  created_at timestamptz default now(),
  uploaded_by text,
  doc_date date,                 -- call date
  doc_type text,                 -- 'earnings_call'
  filename text,
  title text,
  pdf_path text,                 -- storage path in 'calls' bucket (earnings/...)
  ticker text,                   -- Bloomberg code of the reporting company, e.g. 'NVDA US'
  quarter text,                  -- calendar quarter of the fiscal period end, e.g. '2026Q2'
  data jsonb not null
);
alter table earnings_docs enable row level security;
drop policy if exists "team_select" on earnings_docs;
drop policy if exists "team_insert" on earnings_docs;
drop policy if exists "team_update" on earnings_docs;
drop policy if exists "team_delete" on earnings_docs;
create policy "team_select" on earnings_docs for select to anon using (true);
create policy "team_insert" on earnings_docs for insert to anon with check (true);
create policy "team_update" on earnings_docs for update to anon using (true);
create policy "team_delete" on earnings_docs for delete to anon using (true);
create index if not exists earnings_docs_ticker_idx on earnings_docs (ticker);
create index if not exists earnings_docs_quarter_idx on earnings_docs (quarter);

-- ===== Original documents (private bucket; apps read via authenticated storage API) =====
insert into storage.buckets (id, name, public) values ('calls','calls',false)
  on conflict (id) do nothing;
drop policy if exists "team_files_select" on storage.objects;
drop policy if exists "team_files_insert" on storage.objects;
drop policy if exists "team_files_delete" on storage.objects;
create policy "team_files_select" on storage.objects for select to anon using (bucket_id='calls');
create policy "team_files_insert" on storage.objects for insert to anon with check (bucket_id='calls');
create policy "team_files_delete" on storage.objects for delete to anon using (bucket_id='calls');
