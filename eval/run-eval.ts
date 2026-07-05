import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ConversationSchema, LeadProfileSchema } from "../src/schema.js";
import { runPipeline } from "../src/pipeline.js";
import { makeLlmExtractFn } from "../src/extract.js";
import { loadLlmConfigFromEnv } from "../src/llm.js";

/**
 * Regression eval harness. Runs the full pipeline (real LLM call) against
 * every conversation in data/conversations.json, compares the result to
 * eval/golden.json field-by-field, and reports:
 *   - per-field accuracy
 *   - overall precision/recall (treating each non-null/non-empty/non-
 *     "unknown" field as a positive prediction)
 *   - hallucination rate: the fraction of non-null predicted values that
 *     are WRONG relative to golden (this is the north-star metric — see
 *     README "Eval methodology")
 *
 * Exits non-zero if hallucination rate > 0, acting as a regression gate:
 * any change that causes the pipeline to confidently state something
 * false should fail CI, full stop.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const FIELDS = [
  "budgetIDR",
  "areas",
  "intent",
  "urgency",
  "propertyType",
  "timeline",
] as const;
type Field = (typeof FIELDS)[number];

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

interface FieldStats {
  correct: number;
  total: number;
  hallucinations: number;
  predictedNonEmpty: number;
}

interface ConversationReport {
  id: string;
  fieldMatches: Record<Field, boolean>;
  violations: number;
}

async function main(): Promise<void> {
  const llmConfig = loadLlmConfigFromEnv();
  if (!llmConfig) {
    console.error(
      [
        "",
        "  LLM_API_KEY is not set — the eval harness needs a real LLM call.",
        "",
        "  Set the following environment variables and re-run:",
        "    LLM_API_KEY   your API key (required)",
        "    LLM_BASE_URL  base URL of an OpenAI-compatible endpoint (optional,",
        "                  defaults to OpenAI's API)",
        "    LLM_MODEL     model name (optional, defaults to gpt-4o-mini)",
        "",
        "  Example:",
        "    LLM_API_KEY=sk-... LLM_MODEL=gpt-4o-mini npm run eval",
        "",
      ].join("\n")
    );
    process.exit(1);
  }

  const conversationsRaw = JSON.parse(
    readFileSync(join(ROOT, "data/conversations.json"), "utf-8")
  );
  const goldenRaw = JSON.parse(
    readFileSync(join(ROOT, "eval/golden.json"), "utf-8")
  );

  const extractFn = makeLlmExtractFn(llmConfig);
  const stats: Record<Field, FieldStats> = Object.fromEntries(
    FIELDS.map((f) => [f, { correct: 0, total: 0, hallucinations: 0, predictedNonEmpty: 0 }])
  ) as Record<Field, FieldStats>;

  const reports: ConversationReport[] = [];
  let totalViolations = 0;

  for (const raw of conversationsRaw) {
    const conversation = ConversationSchema.parse(raw);
    const golden = LeadProfileSchema.parse(goldenRaw[conversation.id]);

    const { profile, violations } = await runPipeline(conversation, extractFn);
    totalViolations += violations.length;

    const fieldMatches: Record<Field, boolean> = {} as Record<Field, boolean>;

    for (const field of FIELDS) {
      const predicted = profile[field];
      const expected = golden[field];
      stats[field].total += 1;

      const predictedEmpty = isEmptyValue(field, predicted);
      const match = valuesEqual(field, predicted, expected);
      fieldMatches[field] = match;

      if (match) stats[field].correct += 1;
      if (!predictedEmpty) {
        stats[field].predictedNonEmpty += 1;
        if (!match) stats[field].hallucinations += 1;
      }
    }

    reports.push({ id: conversation.id, fieldMatches, violations: violations.length });
  }

  // --- print report table ---
  console.log("\nPer-conversation results:\n");
  console.log(
    ["id".padEnd(38), ...FIELDS.map((f) => f.padEnd(12)), "violations"].join(" ")
  );
  for (const r of reports) {
    console.log(
      [
        r.id.padEnd(38),
        ...FIELDS.map((f) => (r.fieldMatches[f] ? "OK".padEnd(12) : "MISMATCH".padEnd(12))),
        String(r.violations),
      ].join(" ")
    );
  }

  console.log("\nPer-field accuracy:\n");
  let totalCorrect = 0;
  let totalFields = 0;
  let totalPredictedNonEmpty = 0;
  let totalHallucinations = 0;
  for (const field of FIELDS) {
    const s = stats[field];
    totalCorrect += s.correct;
    totalFields += s.total;
    totalPredictedNonEmpty += s.predictedNonEmpty;
    totalHallucinations += s.hallucinations;
    const acc = ((s.correct / s.total) * 100).toFixed(1);
    console.log(`  ${field.padEnd(14)} accuracy=${acc}%  (${s.correct}/${s.total})`);
  }

  const overallAccuracy = totalCorrect / totalFields;
  const precision =
    totalPredictedNonEmpty === 0
      ? 1
      : (totalPredictedNonEmpty - totalHallucinations) / totalPredictedNonEmpty;
  const recall = totalCorrect / totalFields;
  const hallucinationRate =
    totalPredictedNonEmpty === 0 ? 0 : totalHallucinations / totalPredictedNonEmpty;

  console.log("\nOverall:\n");
  console.log(`  accuracy:           ${(overallAccuracy * 100).toFixed(1)}%`);
  console.log(`  precision:          ${(precision * 100).toFixed(1)}%`);
  console.log(`  recall:             ${(recall * 100).toFixed(1)}%`);
  console.log(`  hallucination rate: ${(hallucinationRate * 100).toFixed(1)}%`);
  console.log(`  guardrail violations caught: ${totalViolations}`);

  const report = {
    generatedAt: new Date().toISOString(),
    model: llmConfig.model,
    overall: { accuracy: overallAccuracy, precision, recall, hallucinationRate },
    perField: stats,
    perConversation: reports,
    guardrailViolations: totalViolations,
  };
  writeFileSync(join(ROOT, "eval/report.json"), JSON.stringify(report, null, 2));
  console.log("\nWrote eval/report.json");

  if (hallucinationRate > 0) {
    console.error("\nREGRESSION GATE FAILED: hallucination rate > 0\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Eval run failed:", err);
  process.exit(1);
});
