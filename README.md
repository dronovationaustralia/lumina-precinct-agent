# Lumina Precinct Agent

A Dronovation Labs product. Headless, agentic BI for Sydney train-station precincts:
an API-first agent (LangChain.js / LangGraph.js on Meta's Muse models) that answers
questions about property, transport and land use, checks every number against query
results, and returns map actions and chart specs that any front end can render.

Built for the Meta Global AI Developer Hackathon (27 Oct – 4 Nov 2026). See
[`CHANGELOG.md`](CHANGELOG.md) for dated progress.

> Status: 28 Oct. Agent core, governed data layer, headless API v1 and the portal Ask page work end to end on **labelled demo data**. Real NSW data and SAM 3.1 land use come next.

## How it works

```
Clients: Portal | Quest app (VR Start) | curl / agents
                    \        |        /
           Headless API  /api/v1/*  (Next.js route handlers)
                             |
           Agent graph (LangGraph.js)
   plan <-> tools (governed) -> compose -> verify -> respond
                                   ^          |
                                   +-- retry once, then template fallback
                             |
   Tools: query_metric | land_use | run_sql | search_place | list_datasets
                             |
   Postgres + PostGIS: aggregate views only, read-only agent_ro role
```

- **Verified numbers.** Tools register every figure as a numbered fact. The model writes `{f3}`, never digits. A deterministic verifier (no model) checks every placeholder, bans causal, predictive and advice wording, validates map actions and charts, and confirms all SQL went through the guard. Failures retry once, then fall back to a template answer. The result is returned as `verification` on every answer.
- **Governed data.** Metrics are defined once in `src/server/metrics/catalogue.ts`. The agent role can read only aggregate views (`db/schema.sql`), never row-level sales; figures from fewer than 10 sales are suppressed. `run_sql` is parsed with the real Postgres parser, allowlisted, row-limited and run read-only with a timeout.
- **Headless.** Map actions (`fly_to`, `set_radius`, `highlight`, `compare`, `show_layer`) and Vega-Lite charts are data, so the portal and the Quest app render the same answer.

## API (v1)

| Route | Purpose |
| --- | --- |
| `POST /api/v1/ask` | `{ "question": "..." }` → lines, facts, sources, actions, follow-ups, chart, verification, meta. `Accept: text/event-stream` streams progress events |
| `GET /api/v1/stations` | Station registry |
| `GET /api/v1/metrics?station=chatswood&ring=0-800m` | Every catalogued metric for a station |
| `GET /api/v1/landuse/{station}` | Land-use % per ring and ring GeoJSON |
| `GET /api/v1/health` | Provider, model, database, dataset versions |

```bash
curl -s localhost:3000/api/v1/ask -H 'content-type: application/json' \
  -d '{"question":"Compare Chatswood and St Leonards on price momentum and car-park cover"}'
```

## Setup

Requires Node.js 22.9 or later.

```bash
npm install
cp .env.example .env.local   # then paste your Meta Model API key into MODEL_API_KEY
npm run dev                  # portal at http://localhost:3000
```

`.env.local` is gitignored. Never commit keys.

Without `MODEL_API_KEY` the app runs with the **offline** provider: a rule-based planner that is not a model, used for tests and keyless development. Without `DATABASE_URL` it runs an in-process PGlite database with PostGIS and synthetic data labelled "Demo data" everywhere (first request takes about 15 s to load PostGIS).

```bash
npm test                              # verifier, SQL guard, metric hand checks, agent graph
npm run eval -- --provider meta       # 22 fixed questions on Muse Spark
npm run eval -- --provider offline    # rule-based baseline
```

## Deploy

Azure: App Service (Node 22, Next.js standalone) and Azure Database for PostgreSQL Flexible
Server 16 with PostGIS, in Australia East. Infrastructure is `infra/main.bicep`; deploys run
from GitHub Actions with OpenID Connect. Step-by-step: [`docs/deploy-azure.md`](docs/deploy-azure.md).

```bash
npm run db:setup -- --agent-login --seed-demo   # schema, read-only agent login, demo data
npm run build && npm run package:azure          # .next/standalone, started with `node server.js`
```

## Evals

Latest results are written to `evals/results-<provider>.md`; every run is archived in `evals/runs/`.

| Run (demo data) | Pass | p50 | p95 | Cost per answer |
| --- | --- | --- | --- | --- |
| Muse Spark 1.3, reasoning effort low + speculative compose (29 Oct) | 22 / 22, all verified first time | 7.2 s | 12.0 s | US$0.016 |
| Muse Spark 1.3, reasoning effort medium (29 Oct) | 22 / 22 | 9.9 s | 19.3 s | US$0.021 |
| Muse Spark 1.3, default reasoning (28 Oct) | 22 / 22, all verified first time | 15.1 s | 25.9 s | US$0.024 |
| Offline rules baseline (no model) | 19 / 22 | 0.3 s | 1.3 s | none |

Low effort is the default. Composing the answer is now the slowest step, so `MUSE_COMPOSE_EFFORT`
(eval: `--compose-effort minimal`) can give it a lighter setting than planning.

## Day-1 spikes

| Script | What it checks |
| --- | --- |
| `npm run spike:spark` | Muse Spark tool calling through LangChain.js |
| `npm run spike:chips` then `npm run spike:sam` | SAM 3.1 land-use masks on two NSW aerial chips |
| `npm run spike:voice` | Muse Voice Transcribe on `spikes/audio/question.wav` |

Add `-- --mock` to any spike and run `npm run spike:mock` in another terminal to dry-run
offline against a local stand-in for the API. Results land in `spikes/results/`. Notes are
in [`docs/spikes/2026-10-28-day1.md`](docs/spikes/2026-10-28-day1.md).
