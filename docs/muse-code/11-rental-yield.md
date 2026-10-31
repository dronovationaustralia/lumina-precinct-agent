Add rents and gross rental yield to Lumina Precinct Agent from the NSW rental bond lodgement data, so investors and lenders can ask "What is the gross rental yield for units near Parramatta?" and see a yield map.

Data: the NSW Fair Trading rental bond lodgement files (monthly spreadsheets: lodgement date, postcode, dwelling type, bedrooms, weekly rent) should already be under `data/raw/` (look for a folder or files named like `rental`, `bond` or `rent`; list what you find first). If they are missing, stop and tell me to download the latest 12 months from the NSW Government "Rental bond data" page. Postcode boundaries: the ABS POA 2021 zip under `data/raw/abs/` (see `scripts/ingest/abs-boundaries.ts`, which reads it for the 10 featured stations only).

Context: read `AGENTS.md`, `data/README.md` and an existing ingest + loader pair to follow (for example `scripts/ingest/patronage-parse.ts` + `src/server/db/real-patronage.ts`). Schema `db/schema.sql` (governed views granted to `agent_ro`), metrics `src/server/metrics/catalogue.ts`, map `src/components/portal/MapView.tsx` / `LayerPanel.tsx` / `MapGuide.tsx`.

Rental bonds are lodged by postcode, not address, so be honest about geography:
- For each of the 185 stations, find the postcodes whose area overlaps the 800 m ring, and weight each postcode by its share of the ring's area. Keep this station-to-postcode table in the output.
- Units = dwelling type "F" (flat or unit); houses = "H". Ignore other types for yield.

Build:
1. `scripts/ingest/rental-bonds.ts` (npm `ingest:rents`): read the raw files, keep the latest 12 complete months, write `data/derived/rents.csv` (postcode, dwelling type, month, bonds, median weekly rent) and `data/derived/station_postcodes.csv` (station_id, postcode, ring_share). Print a summary (months covered, bonds read, stations matched). Never commit `data/`.
2. Schema + loader (`src/server/db/real-rents.ts`, dataset `nsw_rental_bonds`, source "NSW Fair Trading rental bond lodgements", licence as published): tables for both files and a governed view `v_station_rent` with, per station and dwelling type, the ring-weighted median weekly rent over 12 months and the bond count. Wire it into the local DB build and `db:setup` (`--load-rents`, part of `--load-real`).
3. Metrics in the catalogue: `median_weekly_rent` (unit/house, within 800 m) and `gross_rental_yield` = median weekly rent × 52 ÷ median sale price for the same dwelling type within 800 m, shown as a percentage to one decimal. Suppress when fewer than 30 bonds or fewer than 10 sales. Labels must say "gross" and "postcode-level rents".
4. Map: add "Gross rental yield (units)" and "(houses)" to the "Colour stations by" control if task 8 added it; otherwise add a station-colour layer for yield with a legend. Explain in `MapGuide.tsx`: rents come from bonds lodged in the postcodes around the station, weighted by area; gross yield ignores costs, vacancy and strata.
5. Agent: the existing `query_metric` tool picks up the new metrics; add the wording rule to the prompt notes ("gross yield, before costs; not financial advice"). Add three eval questions (one unit yield, one house rent, one comparison).
6. Tests: the weighting, the yield formula, suppression thresholds, and the loader (like `tests/cover.test.ts`).

Run `npm test`, `npm run typecheck`, `npm run lint`, then `npm run ingest:rents` and report the yield for the 10 featured stations. CHANGELOG (Sydney date): "Rents and gross rental yield near stations from NSW rental bonds (built with Muse Code)."
