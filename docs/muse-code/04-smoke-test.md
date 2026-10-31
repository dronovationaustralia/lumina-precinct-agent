Add an end-to-end browser smoke test for Lumina Precinct Agent using Playwright.

Context: read `AGENTS.md`. Sign-in: `/signin` has a "Try the demo (no account)" button; the workspace has a station search (`.station-search input`), a question box (`#q`), and each answer card shows "How this answer was made" (`.made`). Without `MODEL_API_KEY` the offline planner answers, which is fine for this test.

Build:
1. Add `@playwright/test` as a dev dependency and `playwright.config.ts` that starts `npm run dev` on port 3100 (`webServer`), Chromium only, one worker, 120 s timeout.
2. `e2e/smoke.spec.ts`: (a) visiting `/` redirects to `/signin`; (b) demo sign-in lands on the workspace; (c) searching "Chatswood" and pressing Enter shows the precinct snapshot heading "Chatswood"; (d) asking "What is the median unit price within 800 m of Chatswood?" produces an answer card with a "Verified" badge and four trail steps; (e) the Layers panel can be hidden with "Hide" and shown again with the "Layers" button.
3. npm script `test:e2e`. Keep `npm test` (Vitest) unchanged and make sure Vitest does not pick up `e2e/`.

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run test:e2e`. CHANGELOG: "Browser smoke test (Playwright) for sign-in, search, answer and layers (built with Muse Code)."
