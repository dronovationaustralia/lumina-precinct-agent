# Changelog

All work in this repository was built during the Meta Global AI Developer Hackathon
(27 Oct – 4 Nov 2026). Dates are Sydney time. No code is copied from earlier Lumina
repositories (`LuminaSpatialInsightsXR`, `LuminaSpatial`, `extended-tableau-mcp`).

## 2026-11-03 (Tue)

### Changed
- "What can I ask?": a complete question is asked straight away; a question that needs a station waits in the box and fills in when you pick one. The Ask button now enables as soon as the box holds a question.
- Land-use and SAM map layers: cached per station on the server (6 hours), featured stations warmed at start-up, and gzipped (land use 345 KB to 55 KB). Repeat loads take milliseconds instead of seconds.

## 2026-11-02 (Mon)

### Added
- Guided playbooks per user type, "What can I ask?", and the any-city story on the landing page and /about (built with Muse Code).
- What SAM 3.1 sees: aerial photo with SAM segmentation revealed on the map (built with Muse Code).
- Corridor tours: a guided, verified station-by-station briefing on the map (built with Muse Code).
- Share links: public precinct cards and verified answers with rich previews (built with Muse Code).
  Answer links are signed by the server when it produces the answer (`share_token` in the /ask response); the share endpoint only accepts that token, so a client cannot get invented figures signed.

## 2026-11-01 (Sun)

### Added
- Station screener: rank and colour all 185 stations by a governed metric (built with Muse Code).
- Opportunity sites: car parks and construction sites found by SAM 3.1 near stations (built with Muse Code).
  Outlines are placed using the imagery's Web Mercator scale (0.5 m ÷ cos latitude per pixel); a first version drew them about 17% too small within each tile.

## 2026-11-02 (Mon)

### Added
- Daily caps for the no-account demo and the public share pages, so an open demo cannot run up
  the Meta bill: Muse Spark answers (`DEMO_DAILY_ASK`, default 400), new Muse Image pictures
  (`DEMO_DAILY_IMAGE`, 60) and voice questions (`DEMO_DAILY_VOICE`, 150), set in the app's
  settings. Invited Microsoft users and API-key clients are not capped. Today's usage is shown in
  `/api/v1/health` (`demo_quota`).

### Changed
- Pre-built questions (playbooks, quick chips, "What can I ask?" examples, snapshot figures) now go
  into the question box instead of being asked at once. Their station follows the selection: with
  no station the box says "[pick a station]", and picking or changing a station updates the
  question until you edit it. Press Ask (or Enter) to send.
- "What SAM 3.1 sees" is now a view you enter and leave: it shows the aerial photo with the land-use
  colours hidden (they covered the photo), and "Back to the normal map" restores the map as it was.
- Boundaries: the hovered suburb, council or postcode now gets a warm fill, a solid outline and
  its name in large type, so it stands out on the map.

### Fixed
- Voice questions failed with "Malformed request": the browser now converts the recording to
  mono 24 kHz 16-bit WAV (the format Muse Voice Transcribe documents) before uploading, and the
  keyword hints are the featured stations plus the selected one instead of all 185 names.

## 2026-10-31 (Sat)

### Added
- `npm run sam:check`: a per-chip, per-class health check for the SAM batch. For each
  chip it reports objects and cover % per class plus a rough vegetation share from the
  imagery (excess green, calibrated on dark eucalypt canopy), and flags chips with under
  10 building objects or tree cover under a third of the vegetation share. Class prompts
  and tiling moved to the shared `scripts/sam/concepts.ts` so the batch and the check
  can never disagree; the vegetation threshold is pinned by a test (built with Muse Code).
- Voice questions: /api/v1/transcribe with Muse Voice Transcribe (built with Muse Code).
- Ask by voice: microphone in the question box (Muse Voice Transcribe; built with Muse Code).
- Brief me: precinct briefing card with a Muse Image illustration and verified figures (built with Muse Code).

### Results
- SAM tuning on Chatswood: re-running with the current code (512 px start tiles, quarter
  splitting, "forest" prompt) fixed both known problems with no prompt changes needed.
  800 m building cover 22.8% to 29% (east-side chips now find 700+ roofs each, checked on
  overlays) and tree canopy 4% to 13.4% (bushland and street trees checked on overlays
  against the excess-green reference). 286 new SAM calls used; the other nine stations
  need about 3,400 more calls, over the 1,500-call tuning budget, so the full run is left
  for a follow-up (their cover stays labelled demo until then).

### Changed
- Custom domain support: with `AUTH_URL` on a custom domain, the default azurewebsites.net
  address forwards there (one address for sign-in cookies and the Microsoft return address);
  Bicep takes `customDomain`.
- Microsoft sign-in can be limited to one organisation: with `AUTH_MICROSOFT_TENANT` set to a
  tenant ID, accounts from other tenants are refused with a clear message.
- Sign-in: the no-account option is now "Try the demo (no account)" and its user shows as "Demo user".
- Azure: the Bicep template now sets the sign-in settings (`AUTH_SECRET`, `AUTH_URL`, optional
  Microsoft app), and no longer sets the unused Baseten key. `db:setup` gains `--load-cover` and
  refreshes the aggregates after any load.

### Fixed
- Deploys: the app now restarts after each deployment, `/api/v1/health` reports the commit it
  was built from, and the deploy waits until the live app reports the new commit. Before, a
  deploy could succeed while the old server kept answering. Deploys also clear the app folder
  first, so pages and caches from earlier builds can no longer be served.
- SAM batch survives network trouble: each SAM call is retried up to five times with growing
  pauses, and a station that still fails is skipped (its finished tiles stay cached) while the
  others carry on; re-running the same command finishes it.
- SAM 3.1 batch: SAM returns at most about 100 objects per image, so dense suburbs were cut off and
  bushland was missed. A tile that hits that ceiling (or whose response is cut short) is now split
  into four quarters, enlarged and segmented again (down to 256 px quarters). Tree cover adds a
  "forest" prompt for continuous canopy. Cache files are versioned (v2), so the next run re-asks. Buildings and trees start at 512 px
  quarters, because whole chips sometimes came back almost empty for dense streets.
- Hydration warning caused by form-filling browser extensions that add `fdprocessedid` to buttons.
- While the local database is rebuilding (first start after a data change, about 3 minutes) the
  workspace now says so, instead of showing an empty map and blank snapshot. "Open the land-use
  breakdown" shows that it is loading, and says why if it can't open.
- Meta models panel: plain status for each model (Live, Offline: no API key set, Not run yet,
  Planned, Development tool, Checking…) with a key explaining them; it no longer says "not
  connected" while the server is still starting.
- SAM 3.1 aerial cover undercounted: at 1 m per pixel it outlined only large buildings and found
  almost no trees or car parks. Chips are now 0.5 m per pixel (512 m across), images are sent at
  high detail, and prompts are literal ("building" plus "house", "tree", "parking lot").

## 2026-10-30 (Fri), late night

### Added
- Screen split: map 60%, answers 40% by default, with an Answers / Split / Map switch in the header.
- Layers panel folds to a "Layers · n on" button ("Hide" in its header); the land-use panel
  minimises to a small bar. "How to read the map" explains stations, rings, lines, price hexagons
  (size, colour groups, why some are dashed), land use and boundaries; the hexagon legend says it too.
- Export and save: under every answer, Copy, Markdown, Export PDF (a clean print report with every
  figure, its source and date, and how the answer was made) and Save. "Saved" lists saved analyses
  (kept in the browser for the signed-in user) and exports them as one report; "Report" exports the
  whole session.
- `npm run sam:batch`: SAM 3.1 aerial land cover for the featured stations (NSW imagery chips over
  the 800 m ring, four concepts per chip, cached per chip, overlays for review); loaded in place of
  the demo cover (`sam_land_cover`). Tested against the mock server; loader test added (57 tests).
- Muse Code task pack (`docs/muse-code/`): five ready-to-run tasks mapped to the judging criteria,
  and project rules for coding agents in `AGENTS.md`.

### Changed
- Charts of one station's categories (such as a land-use mix) are horizontal bars with readable
  labels; land-use series use category names.
- Muse Spark Open (Baseten) removed from the in-app model list; the provider code stays unused.

## 2026-10-30 (Fri), night

### Fixed
- Map showed no streets, lines or hexagons on machines that can reach the basemap: the train-line
  casing used an invalid width expression, and the map treated that error as "basemap unavailable"
  and switched to a plain ground, dropping every layer. The casing is fixed, the basemap is now
  chosen once before the map starts, and map errors are logged instead of switching styles.
- Precinct snapshot showed n/a for station trips (station-level metrics need their own request).

### Added
- Official land use: NSW Landuse 2017 v1.5 (55,372 polygons within 2.1 km of the 185 stations)
  grouped into ten categories (`src/lib/landuse.ts`); `npm run ingest:landuse`; loaded with
  ring shares per station (`land_use_mix`, sums to 100% per ring) computed in GDA2020 MGA 56.
- Land-use map layer for the selected station (`/api/v1/layers/landuse`), coloured by category
  with a legend, hover details, and a land-use panel with stacked bars per ring.
- The agent's `land_use` tool returns the land-use mix as facts (source and 2017 date); prompts say
  "as mapped in 2017". Aerial cover (SAM 3.1 classes) stays, labelled demo until the batch run.

## 2026-10-30 (Fri), evening

### Added
- Sign-in required for the portal and API (`src/proxy.ts`). Microsoft sign-in (Entra ID, any work
  or personal account; authorization code flow with PKCE, ID token checked against Microsoft's keys)
  and a one-click "Try the demo (no account)" session. Sessions are signed HTTP-only cookies. Machine
  clients can use `LUMINA_API_KEYS`. Sign-in page asks the user's work type.
- Work types (development, lending, planning) shape the starter questions, the precinct snapshot
  order and the agent's emphasis (`persona` in `AskRequest`; never the figures). Changeable in the
  header.
- Answer-first workspace: conversation in the centre with answer cards (answer lines with fact
  chips, figure tiles with source and date, chart, sources, follow-ups), a station search over all
  185 stations, a precinct snapshot (six KPIs, click to ask), and the map on the right.
- "How this answer was made" on every answer: Muse Spark planning, the NSW data calls, Muse Spark
  writing, and the checker, with timings. A "Meta AI" panel lists where each Meta model is used
  and its status in this deployment.
- Map shows every train and metro station in its line colour; selected stations get a roundel.
- `npm run fetch:landuse`: NSW Landuse 2017 v1.5 polygons around each station from the NSW map
  service (run on a machine that can reach it).

### Changed
- The local database is saved as a compressed snapshot outside the project folder and loaded into
  memory per process (the dev server can run handlers in more than one worker).

## 2026-10-30 (Fri), late afternoon

### Changed
- All Sydney Trains and Sydney Metro stations: the station registry (185 stations) is generated
  from the TfNSW GTFS feed (`src/lib/station-registry.json`) instead of a fixed list of ten. Station
  ids are validated against it; the ten original stations stay "featured" for demos. The agent's
  prompt names example ids and uses `search_place` for the rest.
- Patronage covers every station (train, metro and shared rows summed per station). 12-month
  patronage and its change are withheld when months are missing (stations on the Bankstown line,
  closed for metro conversion, and the airport stations).
- Sales aggregates are materialized views, refreshed after each load: with 185 stations a sale
  sits in many stations' rings (about 2 million sale-station pairs for Greater Sydney).
- The local database is kept on disk (`data/pglite`, gitignored) and rebuilt only when its inputs
  change: about a minute to build, two seconds to reopen.
- `ingest:gnaf` keeps addresses near any station, using a grid index; `ingest:gnaf` and
  `ingest:geocode` run with 8 GB of heap for Greater Sydney.

## 2026-10-30 (Fri)

### Added
- New portal layout for analysts: the agent on the left (about 40%), the map on the right, and a
  line strip across the top (T1 Western and T1 North Shore) that doubles as the station switcher,
  with each station's 800 m unit median. Starter questions grouped by user (development, lending,
  planning). On phones: strip, map, then the conversation; the layer panel collapses to a button.
- Rail network layer: Sydney Trains T1 to T9, Metro M1 and light rail L1 to L4 in their official
  colours, plus 236 stations, from TfNSW GTFS shapes (`npm run ingest:gtfs-lines`, committed as
  `public/data/network.geojson`, 221 KB). Precinct stations drawn as T1 roundels with name and KPI.
- Sales hexagon layer (units or houses): median price per ~520 m hexagon over the last 12 months,
  from a governed view (`v_sales_hex`); medians from fewer than 10 sales are withheld and the
  hexagon is drawn dashed. Quantile colour ramp with legend; hover shows median and sale count.
- Layer panel (transport, market, land use). The agent's `show_layer` action now switches on the
  sales and lines layers.
- API: `/api/v1/summary` (per-station KPIs) and `/api/v1/layers/sales-hex`.
- Boundaries layer: suburbs (SAL 2021, 208), LGAs (2025, 25) and postcodes (POA 2021, 100) around
  the stations, from ABS ASGS Edition 3 shapefiles (`npm run ingest:boundaries`, committed as
  `public/data/boundaries.geojson`, 850 KB, loaded on first use). Hover highlights an area.

### Changed
- Station locations now come from the TfNSW GTFS parent stops (Greater Sydney GTFS static):
  all 10 stations matched, each within 100 m of the earlier approximate location.
- Scope for this build: data and layers cover the 10 station areas (5 km); Greater Sydney is the
  planned scaling path.

## 2026-10-29 (Thu), early morning

### Added
- `npm run ingest:patronage`: Transport for NSW Train Station Entries and Exits (CC BY 4.0) to
  monthly entries and exits per station. Station rows only; light rail and separate metro stations
  are not added in. Real file: Oct 2024 to Sep 2026, all 10 stations complete, no small-count cells.
- Real patronage replaces the demo patronage in local dev automatically and with
  `db:setup -- --load-patronage` (`--load-real` loads sales and patronage). `LUMINA_REAL_DATA=off`
  keeps demo data. Parser tests. 56 tests. Only land use is still demo data.
- `npm run ingest:gtfs`: station locations from the TfNSW GTFS parent stops, streamed from the
  zip, written to the committed `src/lib/station-coords.json`; the station registry uses them
  when present (`coord_source: gtfs`).

### Changed
- The portal's demo-data notice names only the datasets that are still synthetic (now land use),
  instead of implying every figure is synthetic.

### Results
- Real G-NAF geocoding run: **98.9%** of sales in the stations' own postcodes matched (12,838 of
  12,975); 52,605 sales located within reach of the stations, almost all by lot/plan. Loaded
  locally: every station has enough unit sales within 400 m and 800 m to publish medians; house
  medians within 400 m are suppressed at most stations (fewer than 10 sales), as expected near
  centres. Offline eval on real sales: 19 of 22, same as on demo data.

### Added
- `npm run ingest:vg`: NSW Valuer General bulk sales parser (`scripts/ingest/vg-parse.ts`). Reads
  annual and weekly zips (nested), joins B (sale) to C (lot/plan) records, classifies strata lots as
  units, converts hectares, removes duplicates across weekly files, multi-property dealings,
  part-interest sales, non-residential and nominal sales. Run on the real files: 608,337 sale
  records to 302,540 residential sales in 24 months (23 Oct 2024 to 22 Oct 2026). Licence in
  the files: Creative Commons Attribution, credit Valuation NSW.
- Parser tests on a hand-made fixture (no real records committed). 47 tests.
- Sales geocoding pipeline: `ingest:gnaf` streams the full G-NAF zip without extracting it and
  keeps addresses within 5.6 km of the stations; `ingest:geocode` matches sales by lot/plan, street
  address (Valuer General abbreviations mapped to G-NAF street type codes), address without type,
  then building for units; `ingest:sales` runs all three steps. Greater Sydney reference medians
  feed the affordability metric (`reference_medians` table).
- Reporting-lag cutoff: the window ends three months before the latest contract date (31 Jul 2026
  for the current files), because recent months are only partly lodged. Window: 328,334 sales.
- Real sales load (`db:setup -- --load-sales`, and automatically in the local dev database) replaces
  the demo sales and stores no street addresses. Tested end to end on Postgres 16 + PostGIS.
- Tests for address normalisation and matching (found and fixed a multi-lot parsing bug). 54 tests.
- `infra/main.bicep` can reuse an existing PostgreSQL Flexible Server (`existingPostgresHost`,
  `databaseName`) and then creates only the App Service resources. Guide section added.

## 2026-10-29 (Thu)

### Results
- First live eval on Muse Spark 1.3 (default reasoning, demo data): **22 of 22 pass**, all verified on
  the first attempt (no retries or fallbacks). Latency p50 15.1 s, p95 25.9 s; about 3,900 output
  tokens per answer, about US$0.024 per answer. Offline rules baseline: 19 of 22.

### Changed
- Reasoning effort is now set explicitly (`MUSE_REASONING_EFFORT`, default `low`; sent as
  `reasoning_effort` via `modelKwargs`, because LangChain drops its own `reasoning` option for
  non-OpenAI model names). Eval takes `--effort` to compare settings.
- Speculative compose: after tools have run, the answer is drafted in parallel with the next
  planning turn and used if no more tools are needed, saving one model round trip.
- The compose step now sees non-numeric tool context (dataset names and licences, unmatched
  places) and the covered stations; digits that appear verbatim in that context are allowed.
- Prompts: compare like with like (units vs houses, not all-property medians across rings), name
  the property type with every price, use "associated with" only when relating two measures,
  clearer out-of-scope and no-advice replies.
- Patronage figures display without a duplicated "trips" unit.
- Eval records reasoning tokens, stage timings, attempts and speculative-compose use, prices runs
  at Meta list prices (US$1.25 / US$4.25 per million tokens), and archives every run in `evals/runs/`.
- Mock Meta server answers compose calls with a JSON draft and validates `reasoning_effort`.

- Second live eval, low effort + speculative compose: 22/22 verified first time, p50 7.2 s,
  p95 12.0 s, US$0.016 per answer. Medium effort: 22/22, p50 9.9 s, p95 19.3 s, US$0.021.
  Low kept as the default.
- `MUSE_COMPOSE_EFFORT` (eval `--compose-effort`) sets a separate effort for the compose step.

### Added
- Tests (44): speculative compose path, dataset-context answers, note-token allowance.

## 2026-10-28 (Wed), late afternoon

### Added
- Azure deployment: `infra/main.bicep` (App Service Linux Node 22 running the Next.js standalone
  server; PostgreSQL Flexible Server 16, Burstable, with PostGIS allowlisted; optional second web
  app for the Quest deployment), parameters file and OIDC federated-credential files.
- `npm run db:setup`: applies the schema, creates the read-only `lumina_agent` login (member of
  `agent_ro`) and optionally seeds demo data. Tested against Postgres 16 + PostGIS with a
  non-superuser admin, as on Azure.
- `output: 'standalone'` and `npm run package:azure` (copies static assets into the package).
- GitHub Actions: CI (type check, lint, tests, build) and "Deploy to Azure" with `hackathon` and
  `quest` environments, OIDC login, and a health-check smoke test.
- `docs/deploy-azure.md`: step-by-step PowerShell guide, freeze procedure and hardening list.

### Changed
- Deployed apps run with only `DATABASE_URL_RO`; the admin connection is for setup and local dev.
- ESLint ignores the vendored MapLibre worker.

## 2026-10-28 (Wed), afternoon

### Added
- API contracts (`src/lib/contracts.ts`): `MapAction` identical to the Quest app, facts, follow-ups,
  chart requests, `AskRequest` / `AskResponse`, verification.
- Station registry for the 10 stations (approximate coordinates until GTFS ingest).
- PostGIS schema (`db/schema.sql`) with governed aggregate views, minimum cell size of 10 sales,
  and a read-only `agent_ro` role that cannot read row-level tables.
- Database client: PGlite + PostGIS in process for dev and tests, node-postgres for managed Postgres.
- Synthetic demo data generator, labelled "Demo data" in datasets, facts, sources and answers.
- Metrics catalogue: median price, price per m² of land, sales count, 12-month momentum, transit
  premium, transit-affordable share, patronage and patronage change, four land-use cover metrics.
- Governed tools: `query_metric`, `land_use`, `run_sql` (libpg-query parse, view allowlist,
  function denylist, row limit, read-only transaction, timeout), `search_place`, `list_datasets`.
- Agent graph (LangGraph.js): plan ⇄ tools (max 5 calls) → compose → deterministic verify →
  retry once → template fallback → respond. Charts built server-side from cited facts (Vega-Lite).
- Providers: Muse Spark (Meta Model API), Muse Spark Open (Baseten), and an offline rule-based
  planner for tests and keyless dev.
- Headless API v1: `/ask` (JSON or streamed progress), `/stations`, `/metrics`, `/landuse/{station}`,
  `/health`; CORS for the Quest app; per-IP rate limit.
- Tests (Vitest, 41): verifier, SQL guard, metric hand checks on Chatswood and Parramatta,
  suppression, role permissions, agent retry and fallback paths.
- Eval script v1 (`npm run eval`): 22 questions; offline baseline 19/22.

- Portal Ask page: MapLibre map (open basemap with an offline fallback ground) that runs the
  agent's map actions; conversation with streamed progress; every figure rendered as a
  numbered, traceable fact with a ledger of label, source and as-of date; verification
  details (checks, tool calls, SQL); Vega-Lite charts; land-use panel; follow-ups; demo-data
  and offline-planner notices. Responsive down to phone width; dark mode.
- `templates` in `AskResponse`: the answer lines with `{fN}` placeholders for clients.

### Changed
- Public Sans loaded from Google Fonts in the browser instead of `next/font` (the build
  environment cannot reach Google Fonts).

## 2026-10-28 (Wed), morning

### Added
- Next.js app scaffold (App Router, TypeScript, Tailwind, ESLint) via `create-next-app`.
- `CHANGELOG.md`, `LICENSE` placeholder (licence to be chosen before the repo goes public),
  `.env.example` for the Meta Model API key and model ids.
- Day-1 spike harness in `spikes/`:
  - `01-muse-spark-tools.ts`: Muse Spark native tool calling through LangChain.js
    (`ChatOpenAI` against `https://api.meta.ai/v1`), on Chat Completions and Responses,
    with Zod argument checks and a fact-placeholder check on the answer.
  - `fetch-nsw-chips.ts` + `02-sam-landuse.ts`: two 1024 px aerial chips (Parramatta,
    Chatswood) from NSW Spatial Services, segmented by SAM 3.1 for building, tree canopy,
    car park and construction site; % cover per class and SVG overlays.
  - `03-voice-transcribe.ts`: Muse Voice Transcribe one-shot upload, with and without
    station-name keyword biasing, scored by word error rate.
  - `mock-meta-server.ts`: offline stand-in that checks request shapes against the
    documented API rules and logs payloads.
- Spike notes: `docs/spikes/2026-10-28-day1.md` (model ids, API call shapes, dry-run
  findings, live-run checklist).
