# AI Data Center Capacity & Valuation Extraction

**Built:** August 17, 2026 · **Format:** replicates the user's CRWV-vs-NBIS screenshot framework across the AI-infrastructure universe · **Sources:** SEC filings (10-K/10-Q/8-K/6-K/20-F), IR press releases, investor decks, earnings-call transcripts; private-company figures from official announcements and top-tier press (Bloomberg/Reuters/CNBC/FT). Every number carries a verbatim source quote in the workbook's **Sources** sheet.

## Files

| File | Contents |
|---|---|
| `AI_DC_Capacity_Comparison.xlsx` | Main deliverable. Sheets: **Comparison** (24 companies × screenshot metrics, live formulas), **CRWV vs NBIS (User)** (original screenshot values), **Capacity Notes** (per-company MW/backlog definitions + caveats), **Sources** (~200 rows of citations w/ verbatim quotes + verification verdicts), **Read Me** (methodology + comparability warnings) |
| `screenshot_template.json` | Verbatim transcription of the user's source screenshot |
| `data/research_round1.json` | Raw round-1 agent research (15 agents, full quotes) |
| `data/research_round2.json` | Round-2 gap-fill + adversarial verification results |

## Headline extraction (as of Aug 14–17, 2026; $M unless noted)

### Neoclouds & landlord-model DC (full framework applies)

| | EV | Contracted MW | Active MW | Backlog $M | Backlog/MW | EV/Contracted MW | NTM Rev | Notes |
|---|---|---|---|---|---|---|---|---|
| **CoreWeave** | 88,082 | 3,700 (4,200 per 8/11 call) | 1,500 | 104,200 (+>$25B early Q3) | $28.2M | $23.8M | 12,800 | backlog = RPO+committed; FY26 guide |
| **Nebius** | 76,053 | 3,500 (5,000 YE26 tgt) | 390* | 40,000 | $11.4M | $21.7M | 3,200 | *390MW = user figure, not filing-verified |
| **IREN** | 17,498 | 5,000 (secured grid, not customer) | 810 | 15,900 (TCV sum) | $3.2M | $3.5M | 2,900 | MSFT $9.7B + NVDA $3.4B + $2.8B new |
| **Applied Digital** | 9,894 | 1,410 (IT, leased) | 175 | 36,200 | $25.7M | $7.0M | 1,035 | 5 campuses; CRWV + IG hyperscalers |
| **Cipher** | 8,866 | 700 (HPC leased) | 0 | 11,400 | $16.3M | $12.7M | 870 | AWS 300MW + Fluidstack/Google 168MW |
| **TeraWulf** | 11,372 | 839 (IT leased) | 81 | 27,000 | $32.2M | $13.6M | 179 | **Anthropic 401MW/$19B/20yr (Jul-26)** |
| **Hut 8** | 11,097 | 949 (IT leased) | 0 | 26,600 | $28.0M | $11.7M | 300 | Beacon Point 704 + River Bend 245 |
| **Galaxy** | 10,831 | 526 (IT, CoreWeave) | 133 | 10,400 | $19.8M | $20.6M | 320 | Helios; group EV incl. $5B+ digital assets |
| **Core Scientific** | 9,013 | 1,120 | n.d. | 24,000 | $21.4M | $8.0M | 657 | ~590MW CRWV + **~530MW AMD (new, Q2-26)**; CRWV deal voted down Oct-25 |
| **Riot** | 7,459 | 241 (IT) | 0 | 9,800 | $40.7M | $30.9M | 696 | **191MW "frontier AI lab" 20yr lease (8/10/26)** + AMD 50MW |
| **MARA** | 5,580 | 0 (no customer leases) | 0 | — | — | — | 700 | 4.8GW "potential portfolio"; still pure miner |
| **GDS** | 11,494 | n.d. (sqm-based) | n.d. | — | — | — | 1,894 | 757MW committed-unbuilt backlog; 470MW H1 bookings |
| **VNET** | 4,161 | 1,423 (derived) | 907 (wholesale) | — | — | — | 1,717 | +516MW under constr. 85.8% pre-committed |

### Global DC REITs

| | EV | Active MW | Under-constr. MW | Buildable/pipeline | Backlog | NTM Rev | NTM EBITDA | Notes |
|---|---|---|---|---|---|---|---|---|
| **Equinix** | 129,914 | n.d. (cabinets: 282 DCs, ~78% util) | ~700 (co-wide) | ~3GW developable land | 15,000 (RPO) | 10,245 | 5,240 | xScale 196MW under dev., 182MW leased; "Build Bolder" capex raised to $5-7B/yr |
| **Digital Realty** | 88,874 | 3,100 (IT load, 89.8% occ.) | 1,400 (63% pre-leased, ~$20B) | ~8.5GW buildable (incl. UC) | $1.9B *annualized rent* (not TCV — excluded from $ column) | 6,900 | 3,800 | EV/derived 4.5GW = $19.8M/MW; EV/active = $28.7M/MW |

### Hyperscalers (segment capacity/backlog vs **group** EV — EV/MW multiples n.m.)

| | Group EV | Capacity disclosures (no MW stock reported) | Backlog (RPO) | Segment NTM Rev |
|---|---|---|---|---|
| **Amazon / AWS** | 2,883,706 | +3.9GW added 2025; doubling power by end-2027; up to 5GW to Anthropic | 496,000 (AWS, 6.4yr WAL) | 169,000 (Q2×4, +37% YoY) |
| **Microsoft / Azure** | 3,642,066 | ~+1GW per quarter through FY26; 400+ DCs | 678,000 (commercial RPO, ~45% OpenAI at Dec-25) | 360,028 (total co.) |
| **Alphabet / GCP** | 4,086,048 | n.d.; Anthropic 1M TPUs / >1GW 2026 + 3.5GW 2027 | 513,900 (Cloud RPO) | 99,072 (Q2×4, +82% YoY) |
| **Oracle / OCI** | 531,215 | >1.2GW delivered FY26; ~1GW Q1 FY27; Stargate 4.5GW | 638,000 (total RPO, +363%) | 90,000 (FY27 guide) |
| **Meta** | 1,496,047 | Prometheus 1GW + Hyperion→5GW + El Paso 1GW; memo: 7GW 2026 → 14GW 2027 | n/a (buyer) | 243,200 (run-rate) |

### China clouds (segment revenue; no MW disclosed)

| | Group Mkt Cap | Cloud run-rate | Notes |
|---|---|---|---|
| **Alibaba Cloud** | 288,940 | 23,451 (+38% YoY) | RMB380B capex plan → overshooting; RMB480B considered |
| **Baidu AI Cloud** | 35,274 | 6,366 | GPU cloud +184% YoY (Q1-26) |
| **Tencent Cloud** | n.d. | n.d. | rev not broken out; GPU capacity "steps up" late 2026 |

### Private AI (valuation = last round; capacity = committed GW, buyer-side)

| | Valuation | Committed GW | Active GW | Rev run-rate | Key events 2026 |
|---|---|---|---|---|---|
| **OpenAI** | 852,000 | ~30 ($1.4T TCO) | 1.9 (start-26) | >40,000 | $122B round Mar-26 (AMZN $50B/NVDA $30B/SB $30B); confid. IPO filed Jun-26; 250GW-by-2033 ambition |
| **Anthropic** | 965,000 | ~10.9 (ceilings) | ~2.2 (Rainier) | >47,000 | $65B Series H May-26; confid. IPO filed; + $50B Fluidstack own-build |
| **xAI** (in SpaceX) | 250,000 (Feb-26 mark) | ~2.5 (Colossus ~2GW + Saudi 0.5GW) | n.d. | ~2,000 tgt | Acquired by SpaceX 2/2/26 |
| **SpaceX** (SPCX) | 1,844,000 (public mkt cap) | = xAI + orbital | 0 orbital | n.d. | **IPO'd 6/12/26** ($135, raised ~$75B); FCC filing: up to 1M compute satellites |

## Process

1. **Round 1 — 15 parallel research agents** (one per company/group + market data), filings-first sourcing rules, verbatim-quote-or-null discipline.
2. **Round 2 — 5 gap-fill agents** (China clouds, OpenAI live, private AI labs live, Nebius detail, miner balance sheets) **+ 4 adversarial verification agents** re-checking every headline claim against primary sources. Corrections applied (AWS Q2-26 revenue $42.2B not ~$35B; WULF 81MW active at 6/30 vs 102MW in July; APLD lease attribution; CORZ AMD site list; GDS guidance; CRWV backlog composition).
3. **Independent re-confirmation** of the three most extraordinary claims (SpaceX-xAI/SPCX IPO, OpenAI $852B, Anthropic $965B).

## Critical comparability warnings

- **MW definitions differ**: critical IT load (APLD/WULF/HUT/GLXY/RIOT) vs gross utility power (IREN/MARA) vs company-defined "contracted power" (CRWV/NBIS). IREN's 5GW is **self-secured grid power**, mostly without customers — not comparable to APLD's 1,410MW of executed customer leases.
- **Backlog definitions differ**: RPO (CRWV/hyperscalers) vs undiscounted lease TCV over initial terms (miners) vs CFO-quoted committed backlog (NBIS) vs summed announced TCVs (IREN).
- **Double-counting across columns**: Anthropic's GW sit inside AWS/GOOGL/MSFT/WULF; OpenAI's commitments ARE Oracle/Microsoft/CoreWeave backlog; CoreWeave's leases sit inside APLD/GLXY/CORZ capacity. Do not sum columns.
- **Miner net debt excludes BTC treasuries** (MARA 35,577 BTC ~$2.1B; HUT 17,316 ~$1.0B; RIOT 11,380 ~$0.7B; GLXY $3.5B digital assets).
- Market caps: Nasdaq screener, Aug 14, 2026 close, single-source (proxy blocked cross-checks); NBIS share count verified (271.9M).
- Pending prints at build time: IREN FY26 (Aug 27), BIDU Q2 (Aug 18), BABA Jun-qtr (~Aug 20+), VNET Q2.
