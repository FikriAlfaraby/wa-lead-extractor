# Second rater: results

16 October 2026, after the rules and predictions were tagged (`second-rater-prereg`). The rater was a
separate AI agent (Claude, in a fresh session) given only `RULES.md`, the 20 items without model names or
labels, and the conversations under neutral names. Its labels and reasons: `labels-claude.json`; the
comparison: `agreement.json` (`agreement.ts` writes it; a test keeps it current).

| | right | debatable | wrong |
|---|---:|---:|---:|
| my review | 14 | 5 | 1 |
| second rater | 16 | 3 | 1 |

It agreed with mine on 18 of 20 items, Cohen's kappa 0.75. Both disagreements are the same kind: the lead
said "kapan mau pindah masih blm pasti" (when I'll move is still not certain), one model kept "Belum
pasti" and the other "masih blm pasti" as the timeline, and the answer key leaves it empty. I called that
debatable; the rater called the extraction right, since it repeats the lead's own answer and invents no
date.

## The predictions: 5 of 5 held

1. **Right.** 18 of 20 agree.
2. **Right.** Kappa 0.75.
3. **Right.** It labelled the timeline "weekend ini" wrong: a viewing day, not a moving date.
4. **Right.** It labelled 1 of 20 wrong.
5. **Right.** Both disagreements are between right and debatable.

## Limits

One second rater, and an AI one; 20 items. The rules were written by me, after my own labels existed, and
they say what counts as right, which shapes any rater's labels.
