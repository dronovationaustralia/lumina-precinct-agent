Add schools within walking distance of each station to Lumina Precinct Agent: a map layer and verified figures such as "3 public primary schools within 800 m of Chatswood; nearest secondary school 650 m".

Data: the NSW Department of Education "NSW Public Schools Master Dataset" (CSV with school name, code, level of schooling, latitude and longitude, enrolments, and so on) should already be under `data/raw/` (look for files named like `school` or `master_dataset`; list what you find first). If it is missing, stop and tell me to download it from Data.NSW. It covers government schools only: say so wherever the figures appear.

Context: read `AGENTS.md`, `data/README.md`, and follow an existing ingest + loader pair (for example `scripts/ingest/patronage-parse.ts` + `src/server/db/real-patronage.ts`). Schema `db/schema.sql` (governed views granted to `agent_ro`), metrics `src/server/metrics/catalogue.ts`, agent tools `src/server/tools/index.ts`, map `MapView.tsx` / `LayerPanel.tsx` / `MapGuide.tsx`.

Build:
1. `scripts/ingest/schools.ts` (npm `ingest:schools`): keep open schools with valid coordinates within 2 km of any of the 185 stations; group "level of schooling" into primary, secondary, combined (K–12) and special purpose (SSP). Write `data/derived/schools.csv` (code, name, level group, suburb, enrolment if published, lat, lon). Never commit `data/`.
2. Schema + loader (`src/server/db/real-schools.ts`, dataset `nsw_public_schools`, source and licence as published): table with a point geometry; governed views `v_station_schools` (per station: count by level group within 400 m and 800 m, and the straight-line distance to the nearest primary and nearest secondary school) and `v_schools_near` (schools within 2 km of a station, with distance). Wire into the local DB build and `db:setup` (`--load-schools`, part of `--load-real`).
3. Metrics: `schools_count` (by level group, 400 m / 800 m) and `nearest_school_m` (primary / secondary). Labels say "public schools" and "straight-line distance".
4. Map: "Public schools" toggle in the Layers panel: small icons coloured by level group, hover shows name, level and distance from the selected station. Explain in `MapGuide.tsx` (government schools only; straight-line distance; check catchment boundaries before relying on enrolment).
5. Agent: facts through `query_metric`; optionally a `nearby_schools` tool listing the closest five with distances. Two eval questions.
6. Tests for grouping, distances and the loader.

Run `npm test`, `npm run typecheck`, `npm run lint`, then `npm run ingest:schools` and report counts for the 10 featured stations. CHANGELOG (Sydney date): "Public schools within walking distance of stations (built with Muse Code)."
