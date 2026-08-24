# Company data & DCF assumptions — valuation date Aug 24, 2026.
# All figures sourced from latest earnings releases / filings / investor-day
# materials via web research on Aug 24, 2026 (see per-company sources).
# EBIT margins are "economic": SBC treated as a real expense (≈ non-GAAP
# operating margin minus SBC % of revenue; acquisition amortization excluded).

USD = dict(currency="US$", unit="US$ millions", unit_short="$mm", ps_factor=1)
KRW = dict(currency="₩", unit="KRW billions", unit_short="₩bn", ps_factor=1000)
JPY = dict(currency="¥", unit="JPY billions", unit_short="¥bn", ps_factor=1000)

COMPANIES = [
    # ------------------------------------------------------------------ NTNX
    dict(
        ticker="NTNX", ticker_disp="NTNX", name="Nutanix", exchange="NASDAQ", **USD,
        fye_note="FY ends Jul 31; base = FY2026E (guide midpoint; Q4 reports Aug 26, 2026)",
        price=67.35, price_note="Aug 24, 2026 quote",
        shares=287.0, shares_note="wtd diluted Q3 FY26 (incl. converts); 270.3mm Class A outstanding",
        net_cash=655.0, net_cash_note="$2,018mm cash+ST inv − $1,362.5mm converts (2027+2029), Apr 30, 2026",
        tax=0.20, tax_note="GAAP ETR ~11% (NOLs); normalized",
        wacc=0.10, tgr=0.03,
        base_label="FY2026E", base_revenue=2830.0, base_growth=0.115, base_margin=0.09,
        years=["FY2027E", "FY2028E", "FY2029E", "FY2030E", "FY2031E"],
        growth=[0.115, 0.13, 0.15, 0.16, 0.15],
        ebit_margin=[0.10, 0.12, 0.14, 0.16, 0.18],
        da_pct=[0.02] * 5, capex_pct=[0.015] * 5, nwc_pct=-0.20,
        term_margin=0.17, term_margin_note="steady state: ~28% non-GAAP OM − ~10% SBC, taxed, + deferred-rev inflow",
        notes=[
            "Growth: FY26 guide $2.82–2.84B (+11.5%) accelerating toward management's 'mid-to-high-teens by FY2029' framework "
            "(Q3 FY26 call, May 27, 2026) on VMware/Broadcom displacement; ARR $2.43B +15%. Sept-2023 investor-day $3B-ARR-by-FY27 "
            "target looks late by ~a year on the new ARR methodology.",
            "Margins: FY26 non-GAAP op margin ~22.5% guided, but SBC is ~13% of revenue — economic EBIT starts ~10% and scales to 18% "
            "as SBC leverage improves. FCF guide $760–780mm (~27%) is before SBC; to replicate a street-style model set margins to "
            "22.5%→28%. ΔNWC −20% of Δrev captures the deferred-revenue cash inflow of the subscription model.",
            "Net cash treats both converts as debt while using the diluted share count (conservative double-count on the ITM 2027 notes). "
            "$750mm buyback authorization added May 2026 not modeled.",
        ],
        sources=["Q3 FY26 press release + 10-Q (May 27, 2026)", "FY25 10-K", "Q3 FY26 earnings call (Seeking Alpha)",
                 "stockanalysis.com/TipRanks consensus (Aug 2026)"],
    ),
    # -------------------------------------------------------------- EVERPURE
    dict(
        ticker="EVERPURE", ticker_disp="P", name="Everpure (fka Pure Storage)", exchange="NYSE", **USD,
        fye_note="FY ends early Feb; base = FY2026A (ended Feb 1, 2026); renamed from Pure Storage/PSTG Apr 2026",
        price=112.32, price_note="Aug 19, 2026 close (post +22% pop on 2nd hyperscaler win)",
        shares=346.0, shares_note="non-GAAP wtd diluted Q4 FY26; ~331.5mm outstanding",
        net_cash=1500.0, net_cash_note="cash+investments ~$1.5B, no debt (Q1 FY27)",
        tax=0.20, tax_note="normalized; NOLs keep near-term cash taxes low",
        wacc=0.105, tgr=0.03,
        base_label="FY2026A", base_revenue=3670.0, base_growth=0.16, base_margin=0.042,
        years=["FY2027E", "FY2028E", "FY2029E", "FY2030E", "FY2031E"],
        growth=[0.22, 0.20, 0.17, 0.14, 0.12],
        ebit_margin=[0.06, 0.08, 0.10, 0.12, 0.14],
        da_pct=[0.05] * 5, capex_pct=[0.065] * 5, nwc_pct=-0.05,
        term_margin=0.13, term_margin_note="steady state: ~24% non-GAAP OM − ~9% SBC, taxed, + small sub inflow",
        notes=[
            "Growth: FY27 guide $4.41–4.51B (+~22%, raised May 27, 2026); Q1 FY27 +35% with product +55% on the Meta ramp "
            "('low double-digit exabytes' in FY27, H2-weighted). Second top-5 hyperscaler DirectFlash win (Aug 10, 2026) starts "
            "contributing FY2028 — carries the 17–20% middle years. Analyst day Sep 23, 2026 may reset the long-term model.",
            "Margins: FY26 non-GAAP op margin 17.3% but SBC 13.1% of revenue → economic EBIT ~4% base, scaling to 14% on hyperscale "
            "operating leverage (mgmt: hyperscale GM 75–85%, accretive). Street-style: set margins to 17%→22%.",
            "Capex 6.5% of revenue (FY26: 7.2%) reflects testbed/hyperscale investment staying elevated.",
        ],
        sources=["Q1 FY27 press release (May 27, 2026)", "Q4/FY26 press release (Feb 25, 2026)", "FY26 10-K",
                 "2nd hyperscaler win release (Aug 10, 2026)", "Everpure rebrand release (Feb 23, 2026)"],
    ),
    # ------------------------------------------------------------------ SNOW
    dict(
        ticker="SNOW", ticker_disp="SNOW", name="Snowflake", exchange="NYSE", **USD,
        fye_note="FY ends Jan 31; base = FY2026A; total revenue basis (product ≈ 95%)",
        price=325.71, price_note="Aug 24, 2026 quote; Q2 FY27 reports Sep 2, 2026",
        shares=370.0, shares_note="~354mm outstanding + ~4.5% dilution",
        net_cash=1560.0, net_cash_note="~$3.86B cash+inv − $2.3B 0% converts (2027/2029), Apr 30, 2026",
        tax=0.21, tax_note="normalized; large NOLs defer cash taxes",
        wacc=0.105, tgr=0.035,
        base_label="FY2026A", base_revenue=4680.0, base_growth=0.29, base_margin=-0.195,
        years=["FY2027E", "FY2028E", "FY2029E", "FY2030E", "FY2031E"],
        growth=[0.30, 0.28, 0.26, 0.22, 0.18],
        ebit_margin=[-0.14, -0.06, 0.00, 0.06, 0.11],
        da_pct=[0.03] * 5, capex_pct=[0.035] * 5, nwc_pct=-0.15,
        term_margin=0.18, term_margin_note="steady state: ~30% non-GAAP OM − ~15% SBC, taxed, + deferred-rev inflow",
        notes=[
            "Growth: FY27 product guide $5.84B +31% (raised May 27, 2026; Q1 product +34%, NRR 126%, RPO $9.2B +38%). Path hits "
            "~$10B product revenue in FY2030 — one year later than the FY29 target reaffirmed at the Jun 2, 2026 Investor Day "
            "(management framed FY29 $10B as 'worst case'; this model is slightly more conservative). $6B/5-yr AWS pact, Observe deal.",
            "Margins: the SBC problem dominates — SBC still ~29% of revenue (down from 41% FY25; Investor Day glidepath to 27%, "
            "assumed to keep falling). Economic EBIT is negative until ~FY2029, consistent with the Investor Day commitment of GAAP "
            "profitability by Q4 FY28. Non-GAAP op margin 13.5% and adj FCF margin ~23–25% guided for FY27 — a street-style model "
            "(margins 13.5%→28%) roughly triples the DCF value; that is the entire bull/bear debate on SNOW.",
            "ΔNWC −15% of Δrev captures the strong deferred-revenue/prepaid-consumption cash cycle.",
        ],
        sources=["Q1 FY27 press release (May 27, 2026)", "Q4/FY26 press release (Feb 25, 2026)",
                 "Investor Day deck (Jun 2, 2026)", "Morningstar Investor Day note (Jun 2026)"],
    ),
    # ------------------------------------------------------------------ PLTR
    dict(
        ticker="PLTR", ticker_disp="PLTR", name="Palantir", exchange="NASDAQ", **USD,
        fye_note="Calendar FY; base = 2025A; Q2 2026 reported Aug 3, 2026",
        price=177.24, price_note="Aug 24, 2026 quote (52-wk $106–208)",
        shares=2569.0, shares_note="wtd diluted Q2 2026 (10-Q)",
        net_cash=9200.0, net_cash_note="cash + ST Treasuries $9.2B, zero debt (Jun 30, 2026)",
        tax=0.20, tax_note="~1.4% today (NOLs); normalized — NOLs likely consumed inside window",
        wacc=0.105, tgr=0.04,
        base_label="2025A", base_revenue=4480.0, base_growth=0.56, base_margin=0.38,
        years=["2026E", "2027E", "2028E", "2029E", "2030E"],
        growth=[0.82, 0.45, 0.35, 0.28, 0.22],
        ebit_margin=[0.46, 0.48, 0.49, 0.50, 0.50],
        da_pct=[0.01] * 5, capex_pct=[0.015] * 5, nwc_pct=-0.05,
        term_margin=0.42, term_margin_note="~52% economic EBIT taxed + inflows; near current adj-FCF economics",
        notes=[
            "Growth: 2026 guide $8.15B +82% (raised three times; Q2 +93%, US commercial +149%, TCV $3.37B +49%, RDV $13.1B +83%). "
            "No formal analyst-day model exists — path decelerates 82%→22% (2030 ~$25B), ABOVE published consensus (2027 ~$10.2B, "
            "2028 ~$14.4B) because street has under-modeled every quarter; anchors: US Army $10B EA, Maven, NATO, commercial ontology/agent "
            "traction, Rule of 40 at 155.",
            "Margins: Q2 2026 GAAP op margin 47%, adjusted 62%, SBC ~13% of revenue → economic ~46–50% held flat (best software "
            "margin structure ever printed at this scale).",
            "Valuation reality: even at a 41% 5-yr revenue CAGR and 50% margins, the DCF lands far below the price — at ~$455B diluted "
            "market cap the market is paying for the growth path to extend well beyond 2030 (see cross-check below). The yellow cells "
            "make it easy to test what must be true.",
        ],
        sources=["Q2 2026 press release + 10-Q (Aug 3, 2026)", "Q4/FY25 release (Feb 2, 2026)",
                 "CNBC/Investing.com Q2 coverage (Aug 2026)", "consensus aggregators (Aug 2026)"],
    ),
    # ------------------------------------------------------------------ NVDA
    dict(
        ticker="NVDA", ticker_disp="NVDA", name="NVIDIA", exchange="NASDAQ", **USD,
        fye_note="FY ends late Jan; base = FY2026A (ended Jan 25, 2026); Q2 FY27 reports Aug 26, 2026",
        price=210.24, price_note="Aug 24, 2026 quote; mkt cap ~$5.2T",
        shares=24400.0, shares_note="implied diluted (Q1 FY27 NI $58.3B / $2.39 EPS)",
        net_cash=41900.0, net_cash_note="$50.3B cash+securities − $8.5B debt (Apr 26, 2026); excl. equity stakes",
        tax=0.17, tax_note="FY27 guide 16–18%",
        wacc=0.11, tgr=0.035,
        base_label="FY2026A", base_revenue=215900.0, base_growth=0.65, base_margin=0.58,
        years=["FY2027E", "FY2028E", "FY2029E", "FY2030E", "FY2031E"],
        growth=[0.81, 0.28, 0.18, 0.12, 0.08],
        ebit_margin=[0.62, 0.62, 0.60, 0.58, 0.56],
        da_pct=[0.025] * 5, capex_pct=[0.035] * 5, nwc_pct=0.10,
        term_margin=0.44, term_margin_note="≈ 56% EBIT taxed less reinvestment — near current FCF conversion",
        notes=[
            "Growth: FY27 ~$391B (+81%) per consensus, consistent with Q1 FY27 $81.6B actual + $91B Q2 guide and Huang's ≥$1T "
            "cumulative Blackwell+Rubin bookings through CY2027 (GTC Mar 2026; was $500B through CY2026). Deceleration to +8% by FY31 "
            "as the $3–4T-by-2030 AI-infra TAM matures and custom ASICs (~28% of 2026 AI-server units) take share. $0 China assumed, "
            "matching guidance.",
            "Margins: FY26 GAAP op ~60%, Q1 FY27 ~66%, SBC only 3% of revenue — economic EBIT held at 62% fading to 56% on "
            "competition. ΔNWC 10% of Δrev reflects receivable/inventory build (FY26 FCF $96.6B = 45% of revenue).",
            "Rubin ramps H2 2026; OpenAI 10GW/$100B frame, Anthropic/xAI stakes, $118.5B buyback authorization not separately modeled.",
        ],
        sources=["Q1 FY27 press release + 10-Q (May 20, 2026)", "Q4/FY26 release + 10-K (Feb 25, 2026)",
                 "GTC keynotes (Oct 2025 / Mar 2026)", "consensus aggregators (Aug 2026)"],
    ),
    # ------------------------------------------------------------------- AMD
    dict(
        ticker="AMD", ticker_disp="AMD", name="AMD", exchange="NASDAQ", **USD,
        fye_note="Calendar FY; base = 2025A; Q2 2026 reported Aug 4, 2026",
        price=473.25, price_note="Aug 24, 2026 quote; mkt cap ~$760B",
        shares=1670.0, shares_note="wtd diluted Q2 2026; excl. up to 160mm OpenAI warrants",
        net_cash=9900.0, net_cash_note="$13.1B cash+ST inv − $3.25B debt (Jun 27, 2026)",
        tax=0.14, tax_note="non-GAAP rate 13% guided",
        wacc=0.115, tgr=0.035,
        base_label="2025A", base_revenue=34600.0, base_growth=0.34, base_margin=0.18,
        years=["2026E", "2027E", "2028E", "2029E", "2030E"],
        growth=[0.43, 0.38, 0.34, 0.28, 0.22],
        ebit_margin=[0.225, 0.25, 0.275, 0.295, 0.31],
        da_pct=[0.03] * 5, capex_pct=[0.035] * 5, nwc_pct=0.12,
        term_margin=0.26, term_margin_note="≈ 31% economic EBIT taxed less reinvestment",
        notes=[
            "Growth: anchored to the Nov 11, 2025 Financial Analyst Day model — company revenue CAGR >35%, data center >60%, "
            "DC AI >80%, non-GAAP EPS >$20 in 3–5 yrs. Path 43%→22% (~33% CAGR, 2030 ~$143B) sits slightly below the FAD headline, "
            "reflecting ramp risk. Backdrop: OpenAI 6GW + Meta 6GW + Anthropic up-to-2GW MI450 commitments; Helios shipping end-Q3 2026; "
            "mgmt guided 2027 DC revenue to more than double. Consensus: 2026 ~$49.5B, 2027 ~$68B.",
            "Margins: 2025 non-GAAP op 22.5% − SBC ~4.6% → economic ~18% base; path to 31% by 2030 tracks the FAD >35% non-GAAP "
            "target minus SBC. Q2 2026 already 27% non-GAAP.",
            "OpenAI warrants (160mm shares, $0.01 strike, vest per GW + $600 stock milestone) excluded from the count — full vesting "
            "would dilute value/share ~9%; add to shares to test.",
        ],
        sources=["Financial Analyst Day release (Nov 11, 2025)", "Q2 2026 release + 10-Q (Aug 4, 2026)",
                 "OpenAI 6GW agreement (Oct 6, 2025)", "Advancing AI / Helios launch coverage (Jul 2026)"],
    ),
    # -------------------------------------------------------------- SKHYNIX
    dict(
        ticker="SKHYNIX", ticker_disp="000660", name="SK hynix", exchange="KRX", **KRW,
        fye_note="Calendar FY; base = 2025A; H1 2026 reported Jul 29, 2026. Figures in ₩bn",
        price=1730000, price_note="Aug 24, 2026 close (₩1.73M; −42% off high); ADR 'SKHY' = 1/10 share",
        shares=728.9, shares_note="common shares (mm); ₩40T buyback (3.3%) runs Aug–Nov 2026",
        net_cash=69400, net_cash_note="₩88.0T cash − ₩18.6T debt (Jun 30, 2026, post-Kioxia-stake sale)",
        tax=0.22, tax_note="statutory 26.4% less K-Chips credits",
        wacc=0.125, tgr=0.025,
        base_label="2025A", base_revenue=97150.0, base_growth=0.468, base_margin=0.486,
        years=["2026E", "2027E", "2028E", "2029E", "2030E"],
        growth=[2.26, 0.15, -0.20, -0.10, 0.12],
        ebit_margin=[0.74, 0.68, 0.48, 0.34, 0.44],
        da_pct=[0.08, 0.10, 0.14, 0.16, 0.14],
        capex_pct=[0.13, 0.15, 0.22, 0.24, 0.18],
        nwc_pct=0.12,
        term_margin=0.15, term_margin_note="mid-cycle: ~33% OM taxed, less structural capex>D&A gap",
        notes=[
            "Cycle: 2025 was a record (rev ₩97.2T, OM 48.6%); H1 2026 rev ₩131.9T at 74% OM — the most extreme memory pricing "
            "environment ever (DRAM ASP +30% QoQ, NAND +55% QoQ in Q2; capacity sold out into 2027 with ~10 LTA customers). 2026E "
            "~₩317T (+226%) assumes Q3/Q4 track TrendForce's +13–18% price momentum. An explicit down-cycle is modeled for "
            "2028–29 (−20%/−10%, margins to 34%) as Yongin/M15X/P5-era supply lands — timing is the biggest uncertainty; 2027 "
            "FnGuide consensus OP is ₩392T i.e. street models NO down-cycle in 2027.",
            "HBM: >40% of revenue, ~56–58% HBM market share, HBM4 shipping, HBM4E 2027; company sees AI-memory market +30%/yr "
            "through 2030 (terminal anchor). Capex: ₩27.5T 2025, rising steeply (₩54.3T Yongin Y2+M17 approved Aug 2026; ₩600T "
            "Yongin plan) — modeled as 13–24% of revenue with D&A catching up.",
            "Terminal margin 15% of revenue in uFCF terms ≈ 33% mid-cycle OM — well above the pre-HBM era (2024: 35.5% peak-year OM) "
            "reflecting structurally better industry discipline; at the old-regime ~20% mid-cycle OM the value falls ~35%.",
        ],
        sources=["FY25 results (Jan 28, 2026)", "Q2 2026 results (Jul 29, 2026)", "₩40T buyback release (Aug 19, 2026)",
                 "Yongin Y2/M17 approval (Aug 7, 2026)", "TrendForce price forecasts (Jun–Jul 2026)", "FnGuide consensus via Herald (Aug 2026)"],
    ),
    # -------------------------------------------------------------- SAMSUNG
    dict(
        ticker="SAMSUNG", ticker_disp="005930", name="Samsung Electronics", exchange="KRX", **KRW,
        fye_note="Calendar FY; base = 2025A; H1 2026 reported Jul 30, 2026. Figures in ₩bn",
        price=256500, price_note="Aug 24, 2026 close (−8.7% that day on return-plan disappointment)",
        shares=6566.0, shares_note="common 5,846mm + preferred 802mm (prefs valued at common price — see notes)",
        net_cash=167600, net_cash_note="~₩190T gross cash − ~₩22.4T debt (Jun 30, 2026), record",
        tax=0.21, tax_note="~20% implied H1 2026 (credits)",
        wacc=0.115, tgr=0.025,
        base_label="2025A", base_revenue=333610.0, base_growth=0.109, base_margin=0.131,
        years=["2026E", "2027E", "2028E", "2029E", "2030E"],
        growth=[1.04, 0.08, -0.18, -0.08, 0.10],
        ebit_margin=[0.46, 0.42, 0.26, 0.18, 0.26],
        da_pct=[0.09, 0.09, 0.11, 0.12, 0.11],
        capex_pct=[0.10, 0.11, 0.14, 0.15, 0.12],
        nwc_pct=0.10,
        term_margin=0.11, term_margin_note="mid-cycle blended: memory ~30% OM + DX low-single-digit → ~18% group OM taxed",
        notes=[
            "Cycle: H1 2026 rev ₩305.4T with OP ₩146.7T (48% OM) — DS division alone printed a 70% margin in Q2 while mobile took "
            "its first loss since 2011 on memory input costs. 2026E ~₩681T (+104%), in line with ~₩300T consensus OP. Down-cycle "
            "modeled 2028–29 (group margin to 18%; DX/display/Harman cushion the swing vs pure-play memory).",
            "Structural anchors: HBM4/SOCAMM2 shipping for NVIDIA Vera Rubin since Q1 2026 (first mass HBM4 sales), foundry losses "
            "narrowing with Tesla AI5/AI6 (~₩23T, 2nm Taylor) and 2nm HPC wins, P5 Pyeongtaek + Giheung SR5 DRAM fabs building, "
            ">₩110T 2026 semiconductor capex+R&D. Record ₩90–110T 2026 shareholder return (~6–7% of market cap) approved Aug 21, 2026.",
            "Preferred shares (802mm) are valued at the common price here; they trade ~20% below common, so the blended equity value "
            "is ~2% conservative. Terminal margin 11% of revenue ≈ ~18% group mid-cycle OM taxed, less reinvestment.",
        ],
        sources=["Q2 2026 results (Jul 30, 2026)", "FY2025 results (Jan 29, 2026)", "₩90–110T return plan (Aug 21, 2026)",
                 "Samsung newsroom segment data", "TrendForce price forecasts (Jul 2026)"],
    ),
    # ------------------------------------------------------------------ SNDK
    dict(
        ticker="SNDK", ticker_disp="SNDK", name="Sandisk", exchange="NASDAQ", **USD,
        fye_note="FY ends early Jul; base = FY2026A (ended Jul 3, 2026, reported Aug 5, 2026)",
        price=1596.08, price_note="Aug 21, 2026 close",
        shares=155.0, shares_note="~146.4mm outstanding; ~155mm diluted (guide basis)",
        net_cash=4762.0, net_cash_note="$4.76B cash, zero debt (Jul 3, 2026); $14B buyback authorized Aug 2026",
        tax=0.17, tax_note="implied non-GAAP ~16–18%",
        wacc=0.125, tgr=0.03,
        base_label="FY2026A", base_revenue=20254.0, base_growth=1.75, base_margin=0.64,
        years=["FY2027E", "FY2028E", "FY2029E", "FY2030E", "FY2031E"],
        growth=[1.41, 0.18, 0.05, -0.12, 0.08],
        ebit_margin=[0.72, 0.66, 0.55, 0.38, 0.48],
        da_pct=[0.06] * 5, capex_pct=[0.08] * 5, nwc_pct=0.12,
        term_margin=0.22, term_margin_note="managed-supply mid-cycle ~30% OM taxed; old-regime NAND was ~12%",
        notes=[
            "Cycle: the NAND super-cycle took FY26 revenue to $20.3B (+175%) with gross margin exiting at 84.6% (!) and Q4 adj FCF "
            "margin 56%. FY27 +141% tracks consensus (~$49B, EPS ~$202) and Q1 FY27 guide $10.3–10.8B. The Aug 13, 2026 'In Focus' "
            "investor day model (FY28–30: mid/high-teens revenue growth, ~80% GM, ~75% op margin, ~50% FCF margin, capex "
            "mid-single-digit % — on ~$42B of long-term supply agreements with price floors) is haircut here: margins fade 72%→38% "
            "with an explicit FY30 down-cycle (−12%), because no memory model has ever sustained 75% op margins through a cycle.",
            "Terminal margin 22% of revenue (uFCF) ≈ ~30% mid-cycle op margin — a bet that LTAs/supply discipline keep the new "
            "regime; at the historical ~12% NAND mid-cycle the DCF value roughly halves. Demand anchors: ~18% bit-CAGR through 2030, "
            "enterprise-SSD/HBF ramp (SK hynix partnership; OCP spec Aug 2026), 5 hyperscaler engagements.",
            "Zero debt; $14B buyback (9% of mkt cap) not modeled. Kioxia JV extended to 2034 secures captive supply.",
        ],
        sources=["Q4/FY26 press release + 10-K (Aug 5, 2026)", "'In Focus 2026' investor day (Aug 13, 2026)",
                 "TrendForce NAND price data (2026)", "consensus via WallStreetZen/Motley Fool (Aug 2026)"],
    ),
    # ---------------------------------------------------------------- KIOXIA
    dict(
        ticker="KIOXIA", ticker_disp="285A", name="Kioxia Holdings", exchange="TSE", **JPY,
        fye_note="FY ends Mar 31; base = FY2025A (ended Mar 31, 2026); IFRS. Figures in ¥bn; pre-split price (3:1 Oct 2026)",
        price=53500, price_note="Aug 24, 2026 quote (~50% off Jul-2026 peak)",
        shares=550.0, shares_note="~547–554mm; ¥800B buyback announced Jul 2026",
        net_cash=187.0, net_cash_note="¥791B cash − ~¥604B debt (Jun 30, 2026) — first net-cash position ever",
        tax=0.31, tax_note="Japan statutory ~30.6%",
        wacc=0.115, tgr=0.02,
        base_label="FY2025A", base_revenue=2337.6, base_growth=0.37, base_margin=0.372,
        years=["FY2026E", "FY2027E", "FY2028E", "FY2029E", "FY2030E"],
        growth=[3.11, 0.05, -0.15, -0.05, 0.10],
        ebit_margin=[0.78, 0.72, 0.55, 0.40, 0.50],
        da_pct=[0.08] * 5, capex_pct=[0.07] * 5, nwc_pct=0.10,
        term_margin=0.17, term_margin_note="mid-cycle ~28% OM at Japan tax; slightly below Sandisk on mix",
        notes=[
            "Cycle: Q1 FY26 (Jun-2026 qtr) revenue ¥1,767B (+416% YoY) at a 75% non-GAAP op margin; Q2 guide ¥2,390B at 79.5%. "
            "FY26E ¥9.6T (+311%) is the QUICK consensus; no company full-year guidance (withheld on uncertainty). Same explicit "
            "down-cycle shape as the other memory names (FY28–29), landing FY30 at ¥9.0T.",
            "Discipline anchors: 'price and profit first' stance; capex ~¥470B/yr FY26–28 (still below FY23 peak); doubling NAND "
            "output by FY2029 via Yokkaichi Fab7/Kitakami K2 shells; BiCS10 (332-layer) ramping for AI datacenter QLC eSSDs. "
            "Bain fully exited Jul 2026 (overhang gone); WD/Sandisk merger chatter recurring (not modeled); ¥800B buyback.",
            "3-for-1 split effective Oct 1, 2026 — divide price/value-per-share by 3 afterward. No HBM exposure: pure NAND, hence "
            "higher cyclicality and a lower terminal margin than the DRAM names.",
        ],
        sources=["Q1 FY26 results (Jul 31 / Aug 3, 2026)", "FY25 results (May 2026)", "QUICK consensus via moomoo (Jul 2026)",
                 "TrendForce capex/price notes (Jun 2026)", "Bain exit coverage (Jul 8, 2026)"],
    ),
]
