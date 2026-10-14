import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ConversationSchema, LeadProfileSchema } from "../src/schema.js";
import { makeLlmExtractFn } from "../src/extract.js";
import { loadLlmConfigFromEnv } from "../src/llm.js";
import { printReport, scoreRun, type EvalItem } from "./score.js";

/**
 * Regression eval harness. Runs the full pipeline (real LLM call) against
 * every conversation in data/conversations.json and scores the result
 * against eval/golden.json (see score.ts for the metrics).
 *
 * Exits non-zero if hallucination rate > 0, acting as a regression gate:
 * any change that causes the pipeline to confidently state something
 * false should fail CI, full stop.
 *
 * To keep the model outputs and score them again later with no network,
 * use eval/record.ts and eval/score-recording.ts instead.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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

  const conversationsRaw = JSON.parse(readFileSync(join(ROOT, "data/conversations.json"), "utf-8"));
  const goldenRaw = JSON.parse(readFileSync(join(ROOT, "eval/golden.json"), "utf-8"));

  const extractFn = makeLlmExtractFn(llmConfig);
  const items: EvalItem[] = [];
  for (const raw of conversationsRaw) {
    const conversation = ConversationSchema.parse(raw);
    items.push({
      conversation,
      golden: LeadProfileSchema.parse(goldenRaw[conversation.id]),
      extraction: await extractFn(conversation),
    });
  }

  const report = await scoreRun(llmConfig.model, items);
  printReport(report);

  writeFileSync(
    join(ROOT, "eval/report.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2)
  );
  console.log("\nWrote eval/report.json");

  if (report.overall.hallucinationRate > 0) {
    console.error("\nREGRESSION GATE FAILED: hallucination rate > 0\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Eval run failed:", err);
  process.exit(1);
});
