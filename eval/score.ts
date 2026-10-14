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

export interface EvalReport {
  model: string;
  overall: { accuracy: number; precision: number; recall: number; hallucinationRate: number };
  perField: Record<Field, FieldStats>;
  perConversation: ConversationScore[];
  guardrailViolations: number;
  unreadable: number;
}

export interface EvalItem {
  conversation: Conversation;
  golden: LeadProfile;
  /** null when the model's reply could not be read. */
  extraction: LlmExtraction | null;
}

export async function scoreRun(model: string, items: EvalItem[]): Promise<EvalReport> {
  const perField = Object.fromEntries(
    FIELDS.map((f) => [f, { correct: 0, total: 0, hallucinations: 0, predictedNonEmpty: 0 }])
  ) as Record<Field, FieldStats>;
  const perConversation: ConversationScore[] = [];

  for (const { conversation, golden, extraction } of items) {
    // The real pipeline, fed the recorded output: deterministic stage,
    // citation guardrail and merge run exactly as they do live.
    const { profile, violations } = extraction
      ? await runPipeline(conversation, async () => extraction)
      : { profile: EMPTY_LEAD_PROFILE, violations: [] };

    const fieldMatches = {} as Record<Field, boolean>;
    for (const field of FIELDS) {
      const stats = perField[field];
      const match = valuesEqual(field, profile[field], golden[field]);
      fieldMatches[field] = match;
      stats.total += 1;
      if (match) stats.correct += 1;
      if (!isEmptyValue(field, profile[field])) {
        stats.predictedNonEmpty += 1;
        if (!match) stats.hallucinations += 1;
      }
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

  const sum = (key: keyof FieldStats) => FIELDS.reduce((n, f) => n + perField[f][key], 0);
  const correct = sum("correct");
  const total = sum("total");
  const predicted = sum("predictedNonEmpty");
  const hallucinations = sum("hallucinations");

  return {
    model,
    overall: {
      accuracy: correct / total,
      precision: predicted === 0 ? 1 : (predicted - hallucinations) / predicted,
      recall: correct / total,
      hallucinationRate: predicted === 0 ? 0 : hallucinations / predicted,
    },
    perField,
    perConversation,
    guardrailViolations: perConversation.reduce((n, c) => n + c.violations, 0),
    unreadable: perConversation.filter((c) => c.unreadable).length,
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
  console.log(`  hallucination rate: ${pct(overall.hallucinationRate)}`);
  console.log(`  guardrail violations caught: ${report.guardrailViolations}`);
  console.log(`  unreadable replies: ${report.unreadable}`);
}
