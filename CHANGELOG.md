# Changelog

All work in this repository was built during the Meta Global AI Developer Hackathon
(27 Oct – 4 Nov 2026). Dates are Sydney time. No code is copied from earlier Lumina
repositories (`LuminaSpatialInsightsXR`, `LuminaSpatial`, `extended-tableau-mcp`).

## 2026-10-29 (Thu), early morning

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
