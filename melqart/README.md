# Melqart Research Tools

Internal research apps. Each is a single self-contained HTML file — host the files
next to each other (or open locally) and connect each app to the shared team
Supabase project via **⚙ Settings**.

- `index.html` — landing page (Expert / Broker / Earnings cards)
- `earnings-tracker.html` — **Earnings Call Tracker** (this folder's app)
- `db-setup.sql` — one idempotent script for all apps; safe to re-run any time
- `expert-tracker.html`, `broker-tracker.html` — existing apps (not in this folder;
  keep them alongside these files where you host them)

## Setup (once)

1. In Supabase → SQL Editor, run `db-setup.sql`. It now also creates
   **`earnings_docs`** (plus indexes) and keeps the shared private `calls`
   storage bucket. Idempotent — running it again is safe.
2. Open `earnings-tracker.html` → ⚙ Settings → paste the Supabase project URL +
   anon key (same project as the other tools), your Anthropic API key, and your
   name. *Test connection* verifies the table exists.

## Earnings Call Tracker

- **Universe** is embedded in the file: 98 Software + 138 Semiconductor Bloomberg
  codes (the team lists), with verified company names. To add a name, edit the
  `SOFTWARE` / `SEMIS` arrays and the `NAMES` map near the top of the script.
- **Grid** is pre-populated with the last **10 calendar quarters** (rolling —
  always ends at the current quarter, no code changes needed; “+4 older quarters”
  extends the window). A call is bucketed into the calendar quarter its **fiscal
  period ended** (so a January-FY software name reporting its July quarter lands
  in Q3).
- **Upload call**: drop a PDF/TXT transcript (or paste text) → Claude produces
  the analysis (10 tired-brain bullets → one-paragraph takeaway → detailed
  paragraph → per-company sentiment scores −1…+1 with ~5 verbatim quotes each →
  most-positive-to-most-negative ranking) → review, adjust company/quarter →
  save for the whole team. The original file is stored in the `calls` bucket
  under `earnings/`.
- **Read-throughs**: every scored mention of a universe name on *someone else's*
  call shows up on that name too (hollow ring in the grid, its own section in the
  company drawer) — e.g. what TSMC's call implied for NVDA.
- **Ask Claude** answers questions across all stored calls.

### `earnings_docs` row

| column      | meaning                                              |
|-------------|------------------------------------------------------|
| id          | uuid                                                 |
| uploaded_by | team member name                                     |
| doc_date    | call date                                            |
| doc_type    | `earnings_call`                                      |
| filename    | original file name                                   |
| title       | display title                                        |
| pdf_path    | path in `calls` bucket (`earnings/<id>_<file>`)      |
| ticker      | Bloomberg code of the reporting company (`NVDA US`)  |
| quarter     | calendar quarter of fiscal period end (`2026Q2`)     |
| data        | full analysis JSON (below)                           |

### `data` JSON

```json
{
  "company": "NVIDIA", "bbg": "NVDA US",
  "fiscal_label": "Q2 FY2027", "period_end": "2026-07-26", "call_date": "2026-08-26",
  "headline": {"revenue": "…", "growth": "…", "eps": "…", "margin": "…", "guidance": "…"},
  "bullets": ["…10 short, simple bullets…"],
  "takeaway": "one short paragraph — the main takeaway",
  "detailed": "one very detailed paragraph incl. period + headline results",
  "overall_score": 0.6,
  "companies": [
    {"name": "TSMC", "bbg": "2330 TT", "score": 0.4,
     "quotes": ["…up to 5 verbatim quotes…"], "rationale": "why this score"}
  ],
  "ranking": "most positive → most negative, with comment"
}
```

Sentiment scale everywhere: **positive 0.1…1.0 · mixed/neutral 0 · negative
−0.1…−1.0**. Grid colors: blue = positive, red = negative, gray = neutral
(darker = stronger), with the score printed in each cell.
