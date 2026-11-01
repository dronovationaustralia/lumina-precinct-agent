Make Lumina Precinct Agent easier to start with for each target user, and tell the "works for any city" story honestly on the landing and home screens. Run this after tasks 8 (screener), 9 (opportunity sites), 10 (tours) and 13 (share links): it links to them where they exist, and must skip anything that does not.

Context: read `AGENTS.md`. Personas: `src/lib/personas.ts` (shared by sign-in, portal and agent prompts). Sign-in / landing: `src/components/auth/SignIn.tsx`. Workspace home: the `hello` section in `src/components/portal/Portal.tsx`, snapshot `PrecinctSnapshot.tsx`, composer in `Portal.tsx`, answer follow-ups in `AnswerCard.tsx`. Styles: `src/app/globals.css` (use the existing tokens). Map guide pattern: `MapGuide.tsx` (drawer).

Part A: guide each user to the questions that matter to them
1. Extend `PERSONA_INFO` with `playbooks`: 3–4 per persona, each `{ title, why, steps: string[] }`, where steps are question templates with a `{station}` slot. Suggested set (adjust wording, keep it short):
   - Developer: "Screen for opportunity" (rank stations by unit price growth under a price cap; show opportunity sites near the top result), "Precinct due diligence" (median and sales depth, momentum, transit premium, land use and sites near {station}), "Compare two precincts".
   - Lender / valuer: "Is the median supported?" (sales count and median near {station}), "Trend check" (12-month change and monthly sales), "Comparable precincts" (similar stations by unit median).
   - Planner: "Centre health check" (patronage and its change, land use, aerial cover near {station}), "Corridor review" (start a tour), "Housing near transport" (sales activity within 400 m vs 800 m).
   Only include steps whose features exist (screener, sites, tours).
2. Home screen: replace the three plain starter questions with playbook cards for the current persona (title, one-line why, "Start"). Starting a playbook asks its first step with the selected station filled in (or asks the user to pick a station first) and shows the remaining steps as next-step chips under each answer, so the user is walked through.
3. Composer: when a station is selected, show 3 persona-specific quick chips for that station; the placeholder rotates through persona examples.
4. "What can I ask?" link next to the composer opening a drawer with: question types (prices, momentum, sales depth, transit premium, patronage, land use and aerial cover, sites, screening, tours) with one example each, the data behind each with as-of dates (from `/api/v1/health` datasets), and a short "What Lumina won't do" list (no advice on whether to buy, no figures without a source, no forecasts, no individual property records).
5. First-visit tips: a three-step dismissible coach mark (pick a station, ask or start a playbook, read "How this answer was made"), remembered per browser (wrap storage in try/catch).

Part B: tell the scale story, without overclaiming
6. On the landing panel of the sign-in page, add a compact "Built to work for any city" section:
   - One line: "Live for Sydney. The same engine runs anywhere with open transit, map and imagery data."
   - Four adapter tiles, each with what it uses and where it works: Stations and lines (GTFS, published by 1,000+ transit agencies worldwide), Places and land use (OpenStreetMap, global), Aerial cover and sites (SAM 3.1 on any aerial or drone imagery; your own drone surveys replace public imagery), Prices and rents (pluggable: NSW Valuer General today; UK Land Registry, NYC rolling sales and similar registries next).
   - A small static world map (inline SVG, no new dependency, no external map tiles) with Sydney marked "Live" and London, New York and Singapore marked "Next" (outlined, clearly not live).
   - Use "next" or "planned" for anything that is not built; never imply other cities work today.
7. The same story on a public `/about` page (no sign-in; add it to the proxy's public paths): what Lumina does, who it is for, how every figure is checked, the Meta models and where each is used, the scale-out adapters, data sources and licences (from the datasets list), and a link to the repository. Link to it from the sign-in page and the user menu.

Tests: playbook templates fill `{station}` and never reference a missing feature; the "What can I ask?" drawer and `/about` render; `/about` is reachable without a session and other pages still need one.

Run `npm test`, `npm run typecheck`, `npm run lint`. CHANGELOG (Sydney date): "Guided playbooks per user type, 'What can I ask?', and the any-city story on the landing page and /about (built with Muse Code)."
