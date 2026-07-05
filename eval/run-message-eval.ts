import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ConversationSchema,
  LeadProfileSchema,
  AgentProfileSchema,
  type Conversation,
  type AgentProfile,
} from "../src/schema.js";
import { classifyLead, type LeadState } from "../src/classify.js";
import { qualify, detectExplicitStop } from "../src/qualify.js";
import { makeLlmWriteFn } from "../src/writer.js";
import { verifyDraft } from "../src/writer-guardrail.js";
import { makeLlmJudgeFn, type JudgeResult } from "../src/judge.js";
import { loadLlmConfigFromEnv } from "../src/llm.js";

/**
 * Message-quality eval harness: classify -> qualify -> write -> writer
 * guardrail -> LLM-as-judge, over a curated slice of conversations x both
 * agent voice profiles. Reports per-criterion judge means and the
 * guardrail rejection rate, and writes eval/message-report.json.
 *
 * Two deliberate simplifications, both because this eval targets the
 * writer/judge stages, not the extractor (that's run-eval.ts's job):
 *   - LeadProfile comes from eval/golden.json rather than a live extraction
 *     call. Using the trusted ground truth isolates writer/judge quality
 *     from extraction accuracy, and halves the LLM calls per run.
 *   - data/conversations.json has no real timestamps, so lastLeadMessageAt
 *     / firstContactAt are synthesized per conversation below to get a
 *     deliberate mix of warm/cold lead states. None of these fixture
 *     conversations are short enough to trigger "new" (classify.ts's "new"
 *     rule needs <3 lead messages; every fixture conversation has more) —
 *     that state is covered directly in test/classify.test.ts instead.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const EVAL_NOW = "2026-07-06T00:00:00.000Z";

const SELECTED_CONVERSATIONS: { id: string; daysSinceLastReply: number }[] = [
  { id: "c01_bsd_buy_urgent", daysSinceLastReply: 2 }, // warm
  { id: "c02_jaksel_rent_medium", daysSinceLastReply: 20 }, // cold
  { id: "c04_bsd_rent_house_asap", daysSinceLastReply: 1 }, // warm
  { id: "c07_multi_area_rent_apartment", daysSinceLastReply: 18 }, // cold
  { id: "c09_sparse_smalltalk_only", daysSinceLastReply: 3 }, // warm
  { id: "c11_adversarial_agent_states_budget", daysSinceLastReply: 25 }, // cold
];

const JUDGE_CRITERIA = ["grounded", "onVoice", "actionable", "natural"] as const;
type JudgeCriterion = (typeof JUDGE_CRITERIA)[number];

interface CombinationReport {
  conversationId: string;
  agentId: string;
  leadState: LeadState;
  qualification: { state: string; reason: string };
  message: string;
  guardrail: { passed: boolean; violations: string[] };
  judge: JudgeResult;
}

function isoDaysAgo(now: string, days: number): string {
  return new Date(new Date(now).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function main(): Promise<void> {
  const llmConfig = loadLlmConfigFromEnv();
  if (!llmConfig) {
    console.error(
      [
        "",
        "  LLM_API_KEY is not set — the message eval harness needs real LLM calls",
        "  (one for the writer, one for the judge, per conversation x agent).",
        "",
        "  Set the following environment variables and re-run:",
        "    LLM_API_KEY   your API key (required)",
        "    LLM_BASE_URL  base URL of an OpenAI-compatible endpoint (optional,",
        "                  defaults to OpenAI's API)",
        "    LLM_MODEL     model name (optional, defaults to gpt-4o-mini)",
        "",
        "  Example:",
        "    LLM_API_KEY=sk-... LLM_MODEL=gpt-4o-mini npm run eval:messages",
        "",
      ].join("\n")
    );
    process.exit(1);
  }

  const conversationsRaw = JSON.parse(
    readFileSync(join(ROOT, "data/conversations.json"), "utf-8")
  );
  const goldenRaw = JSON.parse(readFileSync(join(ROOT, "eval/golden.json"), "utf-8"));
  const agentsRaw = JSON.parse(readFileSync(join(ROOT, "data/agents.json"), "utf-8"));

  const conversationsById = new Map<string, Conversation>(
    (conversationsRaw as unknown[]).map((c) => {
      const parsed = ConversationSchema.parse(c);
      return [parsed.id, parsed];
    })
  );
  const agents: AgentProfile[] = (agentsRaw as unknown[]).map((a) =>
    AgentProfileSchema.parse(a)
  );

  const writeFn = makeLlmWriteFn(llmConfig);
  const judgeFn = makeLlmJudgeFn(llmConfig);

  const reports: CombinationReport[] = [];
  let rejectedCount = 0;
  const criterionTotals: Record<JudgeCriterion, { sum: number; count: number }> =
    Object.fromEntries(JUDGE_CRITERIA.map((c) => [c, { sum: 0, count: 0 }])) as Record<
      JudgeCriterion,
      { sum: number; count: number }
    >;

  for (const selection of SELECTED_CONVERSATIONS) {
    const conversation = conversationsById.get(selection.id);
    if (!conversation) {
      throw new Error(`Selected conversation "${selection.id}" not found in fixtures`);
    }
    const profile = LeadProfileSchema.parse(goldenRaw[selection.id]);

    const leadState = classifyLead({
      conversation,
      lastLeadMessageAt: isoDaysAgo(EVAL_NOW, selection.daysSinceLastReply),
      firstContactAt: isoDaysAgo(EVAL_NOW, selection.daysSinceLastReply + 30),
      now: EVAL_NOW,
    });

    const qualification = qualify("new", profile, {
      explicitStop: detectExplicitStop(conversation),
    });

    for (const agent of agents) {
      const draft = await writeFn({ profile, leadState, agent });
      const guardrail = verifyDraft(draft, profile, agent);
      if (!guardrail.passed) rejectedCount += 1;

      const judged = await judgeFn(draft, profile, agent);
      for (const criterion of JUDGE_CRITERIA) {
        criterionTotals[criterion].sum += judged[criterion].score;
        criterionTotals[criterion].count += 1;
      }

      reports.push({
        conversationId: selection.id,
        agentId: agent.id,
        leadState,
        qualification,
        message: draft.message,
        guardrail,
        judge: judged,
      });
    }
  }

  const totalCombinations = reports.length;
  const guardrailRejectionRate = rejectedCount / totalCombinations;
  const criterionMeans: Record<JudgeCriterion, number> = Object.fromEntries(
    JUDGE_CRITERIA.map((c) => [
      c,
      criterionTotals[c].count === 0 ? 0 : criterionTotals[c].sum / criterionTotals[c].count,
    ])
  ) as Record<JudgeCriterion, number>;

  console.log("\nPer-combination results:\n");
  console.log(
    ["conversation".padEnd(38), "agent".padEnd(16), "state".padEnd(7), "guardrail"].join(" ")
  );
  for (const r of reports) {
    console.log(
      [
        r.conversationId.padEnd(38),
        r.agentId.padEnd(16),
        r.leadState.padEnd(7),
        r.guardrail.passed ? "PASS" : `REJECTED (${r.guardrail.violations.length})`,
      ].join(" ")
    );
  }

  console.log("\nJudge per-criterion mean score (1-5):\n");
  for (const criterion of JUDGE_CRITERIA) {
    console.log(`  ${criterion.padEnd(12)} ${criterionMeans[criterion].toFixed(2)}`);
  }

  console.log(
    `\nGuardrail rejection rate: ${(guardrailRejectionRate * 100).toFixed(1)}% (${rejectedCount}/${totalCombinations})`
  );

  const report = {
    generatedAt: new Date().toISOString(),
    model: llmConfig.model,
    totalCombinations,
    guardrailRejectionRate,
    judgeCriterionMeans: criterionMeans,
    combinations: reports,
  };
  writeFileSync(join(ROOT, "eval/message-report.json"), JSON.stringify(report, null, 2));
  console.log("\nWrote eval/message-report.json");
}

main().catch((err) => {
  console.error("Message eval run failed:", err);
  process.exit(1);
});
