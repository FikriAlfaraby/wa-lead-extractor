import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIELDS, isEmptyValue, type Field } from "../score.js";

/**
 * The judgment calls behind the README's "by my reading": every fact the exact-text scorer still
 * counts as invented after the 14 Oct fixes. Built from the recorded results with the scorer's own
 * rule for an empty value, so the set does not depend on anyone's labels.
 */

export type Item = {
  id: string;
  model: string;
  conversation: string;
  field: Field;
  predicted: unknown;
  expected: unknown;
};

type Scored = {
  id: string;
  fieldMatches: Record<Field, boolean>;
  predicted: Record<Field, unknown>;
  expected: Record<Field, unknown>;
};

export const RESULTS = [
  "eval/results/2026-10-14-gpt-6-luna.json",
  "eval/results/2026-10-14-gemini-3.8-flash.json",
] as const;

export function judgmentItems(root = "."): Item[] {
  const items: Omit<Item, "id">[] = [];
  for (const path of RESULTS) {
    const result = JSON.parse(readFileSync(join(root, path), "utf8")) as {
      model: string;
      perConversation: Scored[];
    };
    for (const scored of result.perConversation) {
      for (const field of FIELDS) {
        const predicted = scored.predicted[field];
        if (!scored.fieldMatches[field] && !isEmptyValue(field, predicted)) {
          items.push({ model: result.model, conversation: scored.id, field, predicted, expected: scored.expected[field] });
        }
      }
    }
  }
  return items.map((item, i) => ({ id: `i${String(i + 1).padStart(2, "0")}`, ...item }));
}
