# Muse Code task pack

Self-contained tasks for Meta's Muse Code coding agent, each aimed at a judging criterion. Run them
from the repo root; review the diff before committing. The project rules Muse Code follows are in
`AGENTS.md` (do **not** run `muse init`: it would overwrite that file).

## Set up once (Windows PowerShell)

```powershell
irm https://dev.meta.ai/install.ps1 | iex      # installs the muse CLI (open a new terminal after)
muse login                                      # browser sign-in to your Meta developer account
cd <your clone of lumina-precinct-agent>
git checkout -b muse-code/<task>                # one branch per task
```

## Run a task

```powershell
muse exec --prompt-file docs/muse-code/01-voice-endpoint.md
# or interactively, so you can watch and steer:
muse
```

Then check and commit:

```powershell
npm test; npm run typecheck; npm run lint
git add -A
git commit -m "<what it did>" -m "Built-with: Muse Code"
git push -u origin muse-code/<task>
```

Tell Claude the branch name to review it before merging.

## Tasks

| # | Task | Criterion it serves | Size |
| --- | --- | --- | --- |
| 1 | [Voice question endpoint (Muse Voice Transcribe)](01-voice-endpoint.md) | Use of Meta AI tooling | Medium |
| 2 | [Microphone button in the composer](02-voice-button.md) | Demo | Small |
| 3 | [Eval set: 10 more questions](03-eval-questions.md) | Technical depth | Small |
| 4 | [Browser smoke test](04-smoke-test.md) | Technical depth | Small |
| 5 | [README: how each Meta model is used](05-readme-meta.md) | Use of Meta AI tooling, Impact | Small |
| 7 | [Brief me: Muse Image briefing card](07-muse-image-briefing.md) | Use of Meta AI tooling, Demo, Best Creative Build | Medium |
| 6 | [Tune the SAM 3.1 land-cover batch](06-sam-tuning.md) | Use of Meta AI tooling, Technical depth | Medium (runs SAM) |
| 8 | [Station screener: rank and colour all 185 stations](08-station-screener.md) | Impact, Demo | Medium |
| 9 | [Opportunity sites found by SAM 3.1](09-sam-site-finder.md) | Use of Meta AI tooling, Impact, Demo | Large |
| 10 | [Corridor tour: guided, verified briefing](10-corridor-tour.md) | Demo | Medium |
| 11 | [Rents and gross rental yield (NSW rental bonds)](11-rental-yield.md) | Impact | Medium (needs the bond files) |
| 12 | [Public schools within walking distance](12-schools.md) | Impact | Medium (needs the schools file) |
| 13 | [Share links with rich previews](13-share-links.md) | Most Viral on X, Demo | Medium |
| 14 | [Guided playbooks per user, and the any-city story](14-guidance-and-scale.md) | Impact, Demo | Medium (run after 8, 9, 10, 13) |
| 15 | [What SAM 3.1 sees: aerial photo with segmentation on the map](15-sam-vision-layer.md) | Use of Meta AI tooling, Demo | Medium |

Run 1 before 2. Each finished task: note it in the write-up as "built with Muse Code".
