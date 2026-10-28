# Lumina Precinct Agent

A Dronovation Labs product. Headless, agentic BI for Sydney train-station precincts:
an API-first agent (LangChain.js / LangGraph.js on Meta's Muse models) that answers
questions about property, transport and land use, checks every number against query
results, and returns map actions and chart specs that any front end can render.

Built for the Meta Global AI Developer Hackathon (27 Oct – 4 Nov 2026). See
[`CHANGELOG.md`](CHANGELOG.md) for dated progress.

> Status: day 1. Scaffold and model spikes only. Nothing here is real data yet.

## Setup

Requires Node.js 22.9 or later.

```bash
npm install
cp .env.example .env.local   # then paste your Meta Model API key into MODEL_API_KEY
npm run dev                  # portal at http://localhost:3000
```

`.env.local` is gitignored. Never commit keys.

## Day-1 spikes

| Script | What it checks |
| --- | --- |
| `npm run spike:spark` | Muse Spark tool calling through LangChain.js |
| `npm run spike:chips` then `npm run spike:sam` | SAM 3.1 land-use masks on two NSW aerial chips |
| `npm run spike:voice` | Muse Voice Transcribe on `spikes/audio/question.wav` |

Add `-- --mock` to any spike and run `npm run spike:mock` in another terminal to dry-run
offline against a local stand-in for the API. Results land in `spikes/results/`. Notes are
in [`docs/spikes/2026-10-28-day1.md`](docs/spikes/2026-10-28-day1.md).
