Rewrite the "Meta models" part of README.md for Lumina Precinct Agent so a hackathon judge sees exactly how each Meta model is used.

Context: read `AGENTS.md`, `README.md`, `CHANGELOG.md`, `src/components/portal/ModelsPanel.tsx` (the in-app list), `src/server/agent/graph.ts` (agent flow), `scripts/sam/batch.ts` (SAM 3.1 batch) and `docs/muse-code/README.md`.

Write a section "How Lumina uses Meta AI" with:
1. A Mermaid flowchart of one answer: question -> Muse Spark (plan, native tool calls) -> governed SQL tools over NSW open data -> Muse Spark (write with fact placeholders) -> deterministic checker -> answer + map actions; and the offline side path: NSW aerial imagery -> SAM 3.1 -> land cover per ring.
2. A table: model, model id, what it does in Lumina, where to see it in the app, status (live, batch, built with Muse Code).
3. Two short paragraphs: why Muse Spark never writes numbers itself (placeholders + checker), and what Muse Code built (list the CHANGELOG entries marked "built with Muse Code").
Use only facts from the repo; do not invent metrics. Keep the rest of the README intact. CHANGELOG: "README: how Lumina uses Meta AI (built with Muse Code)."
