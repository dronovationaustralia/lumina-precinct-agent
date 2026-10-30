# Muse Code task pack

Self-contained tasks for Meta's Muse Code coding agent, each aimed at a judging criterion. Run them
from the repo root; review the diff before committing. The project rules Muse Code follows are in
`AGENTS.md` (do **not** run `muse init`: it would overwrite that file).

## Set up once (Windows PowerShell)

```powershell
irm https://dev.meta.ai/install.ps1 | iex      # installs the muse CLI (open a new terminal after)
muse login                                      # browser sign-in to your Meta developer account
cd C:\Users\david\DevCenter\lumina-precinct-agent
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
| 6 | [Tune the SAM 3.1 land-cover batch](06-sam-tuning.md) | Use of Meta AI tooling, Technical depth | Medium (runs SAM) |

Run 1 before 2. Each finished task: note it in the write-up as "built with Muse Code".
