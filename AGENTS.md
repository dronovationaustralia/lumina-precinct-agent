<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules (Lumina Precinct Agent)

Read by coding agents (Muse Code, Claude Code) working in this repo.

- Never write secrets, keys or `.env.local` contents into code, logs or commits. Never commit anything under `data/`.
- The agent never invents numbers: every figure must come from a governed SQL view through a tool and pass `src/server/agent/verify.ts`. Do not weaken the verifier or the SQL guard.
- Before finishing a task run `npm test`, `npm run typecheck` and `npm run lint`; all must pass (lint warnings are fine).
- Add one dated entry to `CHANGELOG.md` (Sydney date) describing the change in plain words.
- Commits made by Muse Code end with the trailer `Built-with: Muse Code` so the history shows its work.
- Keep changes small and focused on the task you were given; do not refactor unrelated files.
