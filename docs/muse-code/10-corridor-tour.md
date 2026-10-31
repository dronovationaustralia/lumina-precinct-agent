Add a guided "corridor tour" to Lumina Precinct Agent: one click flies the map station by station along a line and shows a short, verified briefing for each stop, so a user (or a demo video) gets a precinct-by-precinct story in about a minute.

Context: read `AGENTS.md`. Stations and lines: `src/lib/stations.ts`, `public/data/network.geojson`, `src/lib/lines.ts`. Verified figures: the same metric queries used by `src/server/briefing.ts` (`briefingFacts`). Map control: `src/components/portal/MapView.tsx` (fly-to via the map state in `Portal.tsx`). Snapshot UI: `PrecinctSnapshot.tsx`.

Build:
1. `src/lib/tours.ts`: three tours of featured and nearby stations in line order: "North Shore: Wynyard to Chatswood" (Wynyard, Milsons Point, North Sydney, St Leonards, Chatswood), "Parramatta corridor" (Auburn, Granville, Harris Park, Parramatta, Westmead), and one built from any line the user picks (its stations in order, max 8 stops, skipping stations with no sales data).
2. `GET /api/v1/tour/[tour]`: for each stop, the station and 3–4 verified figures (unit median, 12-month change, station trips and change), each with source and date, plus one "headline" sentence per stop built by a template from those figures (no model needed; never a number that is not in the figures). Optional: when the Meta key is set, ask Muse Spark for a one-line headline per stop using fact placeholders and run it through the existing verifier; fall back to the template if it fails.
3. UI: a "Tour" button in the header opens a tour picker. During a tour, a bottom card shows the stop name, line badges, the figures as tiles and the headline; the map flies to each stop (close view, 800 m ring), dwelling 7 s, with Pause, Previous, Next and Exit buttons and a progress bar. Keyboard: space pauses, arrows step. Respect `prefers-reduced-motion` (no fly animation, jump instead).
4. Tests: tour order, skipping stations without data, headlines contain only numbers present in the figures.

Run `npm test`, `npm run typecheck`, `npm run lint`. CHANGELOG (Sydney date): "Corridor tours: a guided, verified station-by-station briefing on the map (built with Muse Code)."
