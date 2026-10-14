import type { Violation } from "../src/guardrail.js";
import { runPipeline } from "../src/pipeline.js";
import { EMPTY_LEAD_PROFILE, type Conversation, type LeadProfile, type LlmExtraction } from "../src/schema.js";

/**
 * Scores the pipeline's final profiles against eval/golden.json. Pure: the
 * model outputs come in as data (from a live run or a recording), so the
 * same function scores both, and a recording can be re-scored in a test.
 *
 *   - per-field accuracy
 *   - precision/recall, treating each non-null/non-empty/non-"unknown"
 *     field as a positive prediction
 *   - hallucination rate: the fraction of non-empty predicted values that
 *     are WRONG relative to golden (the north-star metric — see README
 *     "Eval methodology")
 */

export const FIELDS = ["budgetIDR", "areas", "intent", "urgency", "propertyType", "timeline"] as const;
export type Field = (typeof FIELDS)[number];

function isEmptyValue(field: Field, value: unknown): boolean {
  if (field === "areas") return Array.isArray(value) && value.length === 0;
  if (field === "intent" || field === "urgency") return value === "unknown";
  return value === null;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** The word rule: two free-text values match when every word of the shorter is in the longer. */
function sameWords(a: string, b: string): boolean {
  const [short, long] = words(a).length <= words(b).length ? [words(a), words(b)] : [words(b), words(a)];
  if (short.length === 0) return long.length === 0;
  const pool = new Set(long);
  return short.every((w) => pool.has(w));
}

/**
 * Exact comparison counts "rumah tinggal" against "rumah" as an invented fact. The word rule
 * compares free text (areas, property type, timeline) by words instead: "rumah tinggal" and
 * "rumah" match, "BSD City" and "BSD" match; a translation ("studio apartment") or an extra place
 * ("deket De Park") still does not. Budget, intent and urgency stay exact.
 */
export function valuesMatch(field: Field, predicted: unknown, expected: unknown): boolean {
  if (field === "areas") {
    const p = Array.isArray(predicted) ? predicted.map(String) : [];
    const e = Array.isArray(expected) ? expected.map(String) : [];
    if (p.length === 0 || e.length === 0) return p.length === e.length;
    return e.every((x) => p.some((y) => sameWords(x, y))) && p.every((y) => e.some((x) => sameWords(x, y)));
  }
  if (field === "propertyType" || field === "timeline") {
    return typeof predicted === "string" && typeof expected === "string" ? sameWords(predicted, expected) : predicted === expected;
  }
  return predicted === expected;
}

function valuesEqual(field: Field, a: unknown, b: unknown): boolean {
  if (field === "areas") {
    const arrA = Array.isArray(a) ? [...a].sort() : [];
    const arrB = Array.isArray(b) ? [...b].sort() : [];
    return JSON.stringify(arrA) === JSON.stringify(arrB);
  }
  return a === b;
}

export interface FieldStats {
  correct: number;
  total: number;
  hallucinations: number;
  predictedNonEmpty: number;
}

export interface ConversationScore {
  id: string;
  fieldMatches: Record<Field, boolean>;
  violations: number;
  /** The model's reply could not be read: the pipeline produced no profile for this conversation. */
  unreadable: boolean;
  predicted: LeadProfile;
  expected: LeadProfile;
  /** What the citation guardrail threw out. */
  rejected: Violation[];
}

export interface Overall {
  accuracy: number;
  precision: number;
  recall: number;
  hallucinationRate: number;
}

export interface EvalReport {
  model: string;
  overall: Overall;
  perField: Record<Field, FieldStats>;
  perConversation: ConversationScore[];
  guardrailViolations: number;
  unreadable: number;
  /** The same profiles scored by the word rule (see valuesMatch). */
  byWords: { overall: Overall; perField: Record<Field, FieldStats>; wrong: { conversation: string; field: Field }[] };
}

export interface EvalItem {
  conversation: Conversation;
  golden: LeadProfile;
  /** null when the model's reply could not be read. */
  extraction: LlmExtraction | null;
}

const emptyStats = () =>
  Object.fromEntries(FIELDS.map((f) => [f, { correct: 0, total: 0, hallucinations: 0, predictedNonEmpty: 0 }])) as Record<Field, FieldStats>;

function overallOf(perField: Record<Field, FieldStats>): Overall {
  const sum = (key: keyof FieldStats) => FIELDS.reduce((n, f) => n + perField[f][key], 0);
  const correct = sum("correct");
  const total = sum("total");
  const predicted = sum("predictedNonEmpty");
  const hallucinations = sum("hallucinations");
  return {
    accuracy: correct / total,
    precision: predicted === 0 ? 1 : (predicted - hallucinations) / predicted,
    recall: correct / total,
    hallucinationRate: predicted === 0 ? 0 : hallucinations / predicted,
  };
}

function tally(stats: FieldStats, match: boolean, empty: boolean): void {
  stats.total += 1;
  if (match) stats.correct += 1;
  if (!empty) {
    stats.predictedNonEmpty += 1;
    if (!match) stats.hallucinations += 1;
  }
}

export async function scoreRun(model: string, items: EvalItem[]): Promise<EvalReport> {
  const perField = emptyStats();
  const byWordsField = emptyStats();
  const wrongByWords: { conversation: string; field: Field }[] = [];
  const perConversation: ConversationScore[] = [];

  for (const { conversation, golden, extraction } of items) {
    // The real pipeline, fed the recorded output: deterministic stage,
    // citation guardrail and merge run exactly as they do live.
    const { profile, violations } = extraction
      ? await runPipeline(conversation, async () => extraction)
      : { profile: EMPTY_LEAD_PROFILE, violations: [] };

    const fieldMatches = {} as Record<Field, boolean>;
    for (const field of FIELDS) {
      const empty = isEmptyValue(field, profile[field]);
      const match = valuesEqual(field, profile[field], golden[field]);
      fieldMatches[field] = match;
      tally(perField[field], match, empty);
      const ruleMatch = valuesMatch(field, profile[field], golden[field]);
      tally(byWordsField[field], ruleMatch, empty);
      if (!ruleMatch) wrongByWords.push({ conversation: conversation.id, field });
    }

    perConversation.push({
      id: conversation.id,
      fieldMatches,
      violations: violations.length,
      unreadable: extraction === null,
      predicted: profile,
      expected: golden,
      rejected: violations,
    });
  }

  return {
    model,
    overall: overallOf(perField),
    perField,
    perConversation,
    guardrailViolations: perConversation.reduce((n, c) => n + c.violations, 0),
    unreadable: perConversation.filter((c) => c.unreadable).length,
    byWords: { overall: overallOf(byWordsField), perField: byWordsField, wrong: wrongByWords },
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function printReport(report: EvalReport): void {
  console.log(`\n${report.model}: per-conversation results\n`);
  console.log(["id".padEnd(38), ...FIELDS.map((f) => f.padEnd(12)), "violations"].join(" "));
  for (const r of report.perConversation) {
    console.log(
      [
        r.id.padEnd(38),
        ...FIELDS.map((f) => (r.fieldMatches[f] ? "OK" : "MISMATCH").padEnd(12)),
        r.unreadable ? "unreadable" : String(r.violations),
      ].join(" ")
    );
  }

  console.log("\nPer-field accuracy:\n");
  for (const field of FIELDS) {
    const s = report.perField[field];
    console.log(`  ${field.padEnd(14)} accuracy=${pct(s.correct / s.total)}  (${s.correct}/${s.total})`);
  }

  const { overall } = report;
  console.log("\nOverall:\n");
  console.log(`  accuracy:           ${pct(overall.accuracy)}`);
  console.log(`  precision:          ${pct(overall.precision)}`);
  console.log(`  recall:             ${pct(overall.recall)}`);
  console.log(`  hallucination rate: ${pct(overall.hallucinationRate)}  (by the word rule: ${pct(report.byWords.overall.hallucinationRate)})`);
  console.log(`  guardrail violations caught: ${report.guardrailViolations}`);
  console.log(`  unreadable replies: ${report.unreadable}`);
}
