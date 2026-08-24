# 5-Year DCF Models — AI Infrastructure & Data Platforms

Built August 24, 2026. Ten companies: Nutanix, Everpure (fka Pure Storage), Snowflake,
Palantir, NVIDIA, AMD, SK hynix, Samsung Electronics, Sandisk, Kioxia.

## Files

- **`dcf_models.xlsx`** — the deliverable. One live-formula DCF tab per company plus a
  linked Summary tab and a ReadMe tab with methodology. Blue cells are inputs; yellow
  cells are the key levers (growth, EBIT margin, WACC, terminal growth, terminal margin);
  everything else recalculates. Each tab ends with a WACC × terminal-growth sensitivity
  grid and assumption notes with sources.
- **`build_dcf.py`** — generator (openpyxl). Rebuild with `python build_dcf.py`, then
  recalculate formulas (openpyxl writes formulas without cached values) using LibreOffice,
  e.g. the Claude xlsx skill's `recalc.py`.
- **`company_data.py`** — all assumptions and sourced base-year data, one dict per company.

## Method in one paragraph

Unlevered DCF: revenue path anchored to company guidance and analyst-day targets
(AMD's Nov-2025 FAD model, Sandisk's Aug-2026 investor day, Snowflake's Jun-2026
Investor Day / $10B FY29 target, NVIDIA's ≥$1T Blackwell+Rubin bookings, Nutanix's
mid/high-teens-by-FY29 framework, Everpure's hyperscaler ramps, memory-cycle data from
TrendForce and the companies). EBIT margins are "economic" — SBC treated as a real
expense. uFCF = NOPAT + D&A − capex − ΔNWC, discounted mid-year. Terminal value uses a
normalized terminal-FCF margin (mid-cycle for the memory names, steady-state for the
high-SBC software names) so the perpetuity never capitalizes peak or transition-year
economics. KRW/JPY names are modeled in local currency.

Not investment advice.
