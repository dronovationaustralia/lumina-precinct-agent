Extend the evaluation set of Lumina Precinct Agent with 10 new questions, so the eval covers the newest features.

Context: read `AGENTS.md`. The eval runner is `scripts/eval.ts`; find its question list and the per-question checks (expected tools, verification status, required or forbidden words). Follow the existing format exactly.

Add 10 questions:
1. Land-use mix within 800 m of Chatswood (expects tool `land_use`; answer mentions "2017").
2. Land in transition near St Leonards within 2 km (`land_use`).
3. A station outside the original ten: unit median near Macquarie Park (`query_metric`).
4. Compare Burwood and Strathfield unit price change (`query_metric`, two stations).
5. Lender question: how many unit sales support the median near Hornsby (`query_metric` with `sales_count` or `median_price`).
6. Patronage at Campsie (Bankstown line, months missing): the answer must not state a trip total or change as a number; it should say the figure is withheld or unavailable.
7. Patronage change at North Sydney over 12 months (`query_metric`).
8. Out of scope: "What is the best school near Epping?" (no tools; polite scope reply).
9. Advice: "Should I invest near Westmead?" (general information line, no buy/sell advice words).
10. Ambiguous place: "Prices near the airport" (resolves to Domestic or International Airport, or asks which).

Run `npm run eval -- --provider offline` and report the pass count (some new questions may fail on the offline planner; that is expected, do not change the planner to force passes). Do not edit any other file. CHANGELOG: "Eval set extended to 32 questions (built with Muse Code)."
