# Predictions for the second rater, written before it labels anything

16 October 2026. The 20 items are the facts the exact-text scorer still counts invented after the
14 October fixes (`items.ts`). My own labels for them are in `eval/review/2026-10-14.json`: 14 right,
5 debatable, 1 wrong. The second rater is a separate AI agent (Claude, in a fresh session) that sees
only `RULES.md`, the 20 items without model names or labels, and the conversations' messages under
neutral names (`write-inputs.ts`). It never sees my labels or these predictions.

1. **It agrees with my label on at least 15 of the 20 items.**
2. **Cohen's kappa between us is at least 0.40.**
3. **It labels the timeline "weekend ini" wrong**, the one item I labelled wrong.
4. **It labels at most 3 of the 20 wrong.**
5. **Most disagreements are between right and debatable**, not involving wrong.

What would surprise me: it labelling five or more items wrong, which would mean "by my reading, one is
clearly wrong" was generous to the models.
