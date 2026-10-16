import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judgmentItems, type Item } from "./items.js";

/**
 * How far the second rater agrees with my review on the 20 judgment calls: the count, Cohen's kappa,
 * the confusion matrix and every disagreement with both reasons.
 *
 *   npx tsx eval/second-rater/agreement.ts     # writes eval/second-rater/agreement.json
 */

export const LABELS = ["right", "debatable", "wrong"] as const;
export type Label = (typeof LABELS)[number];
type Rated = { id: string; label: Label; why: string };
type Reviewed = { model: string; conversation: string; field: string; category: string; why: string };

const REVIEW = "eval/review/2026-10-14.json";
const RATER = "eval/second-rater/labels-claude.json";
export const OUT = "eval/second-rater/agreement.json";

function isLabel(value: string): value is Label {
  return (LABELS as readonly string[]).includes(value);
}

/** Observed agreement corrected for the agreement two raters with these label rates reach by chance. */
export function cohenKappa(a: readonly Label[], b: readonly Label[]): number {
  if (a.length !== b.length || a.length === 0) throw new Error("kappa needs two label lists of one length");
  const n = a.length;
  const observed = a.filter((x, i) => x === b[i]).length / n;
  const share = (list: readonly Label[], label: Label) => list.filter((x) => x === label).length / n;
  const chance = LABELS.reduce((sum, label) => sum + share(a, label) * share(b, label), 0);
  return chance === 1 ? 1 : (observed - chance) / (1 - chance);
}

function mine(items: Item[], root: string): Reviewed[] {
  const facts = (JSON.parse(readFileSync(join(root, REVIEW), "utf8")) as { facts: Reviewed[] }).facts;
  return items.map((item) => {
    const found = facts.find((f) => f.model === item.model && f.conversation === item.conversation && f.field === item.field);
    if (!found || !isLabel(found.category)) {
      throw new Error(`my review has no right/debatable/wrong label for ${item.model} ${item.conversation} ${item.field}`);
    }
    return found;
  });
}

function theirs(items: Item[], root: string): Rated[] {
  const rated = JSON.parse(readFileSync(join(root, RATER), "utf8")) as Rated[];
  if (rated.map((r) => r.id).join() !== items.map((i) => i.id).join()) {
    throw new Error("the second rater's labels are not the 20 items in order");
  }
  for (const r of rated) if (!isLabel(r.label)) throw new Error(`${r.id}: label ${String(r.label)} is not in the rules`);
  return rated;
}

export function agreement(root = ".") {
  const items = judgmentItems(root);
  const a = mine(items, root);
  const b = theirs(items, root);
  const mineLabels = a.map((x) => x.category as Label);
  const theirLabels = b.map((x) => x.label);
  const count = (list: Label[]) => Object.fromEntries(LABELS.map((l) => [l, list.filter((x) => x === l).length]));
  const matrix = Object.fromEntries(
    LABELS.map((m) => [m, Object.fromEntries(LABELS.map((t) => [t, mineLabels.filter((x, i) => x === m && theirLabels[i] === t).length]))]),
  );
  return {
    items: items.length,
    agree: mineLabels.filter((x, i) => x === theirLabels[i]).length,
    kappa: Math.round(cohenKappa(mineLabels, theirLabels) * 100) / 100,
    mine: count(mineLabels),
    theirs: count(theirLabels),
    matrix,
    disagreements: items
      .map((item, i) => ({ item, i }))
      .filter(({ i }) => mineLabels[i] !== theirLabels[i])
      .map(({ item, i }) => ({
        id: item.id,
        model: item.model,
        conversation: item.conversation,
        field: item.field,
        extracted: item.predicted,
        answerKey: item.expected,
        mine: mineLabels[i],
        mineWhy: a[i].why,
        theirs: theirLabels[i],
        theirWhy: b[i].why,
      })),
  };
}

if (process.argv[1]?.endsWith("agreement.ts")) {
  const result = agreement();
  writeFileSync(OUT, JSON.stringify(result, null, 1) + "\n");
  console.log(`${OUT}: ${result.agree} of ${result.items} agree, kappa ${result.kappa}`);
}
