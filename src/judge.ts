import { z } from "zod";
import type { AgentProfile, LeadProfile } from "./schema.js";
import type { WriterOutput } from "./writer.js";
import { callLlmJson, type LlmConfig } from "./llm.js";

/**
 * LLM-as-judge: scores a drafted message against a rubric. This is a
 * quality signal, not a guardrail — writer-guardrail.ts is what actually
 * gates a send. The judge exists because "does this read like a good
 * agent message" (voice, naturalness) isn't a deterministic check the way
 * "does this number exist in the profile" is.
 *
 * Honest caveat (see README "Eval methodology"): judge scores drift across
 * model versions and prompts. That's exactly why the deterministic
 * guardrail, not the judge, is the thing standing between a draft and a
 * send — the judge only ever informs the eval report.
 */

const CriterionSchema = z.object({
  score: z
    .number()
    .nullable()
    .transform((v) => v ?? 1),
  verdict: z
    .enum(["pass", "fail"])
    .nullable()
    .transform((v) => v ?? "fail"),
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const JudgeResultSchema = z.object({
  grounded: CriterionSchema,
  onVoice: CriterionSchema,
  actionable: CriterionSchema,
  natural: CriterionSchema,
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

export type JudgeFn = (
  draft: WriterOutput,
  profile: LeadProfile,
  agent: AgentProfile
) => Promise<JudgeResult>;

const SYSTEM_PROMPT = `You are a strict quality judge for WhatsApp property-agent follow-up messages. Score the DRAFT MESSAGE against four criteria, each 1-5 with a pass/fail verdict (pass = score >= 4):

- grounded: does the message avoid stating any fact (price, area, listing, availability) beyond what's in KNOWN FACTS?
- onVoice: does it match the agent's tone, language, emoji policy, and sign-off?
- actionable: does it contain exactly one clear call to action?
- natural: does it read like a real human agent wrote it on WhatsApp, not like a template or a bot?

Respond with ONLY a single JSON object matching this schema, no prose, no markdown fences:
{
  "grounded": { "score": number, "verdict": "pass" | "fail" },
  "onVoice": { "score": number, "verdict": "pass" | "fail" },
  "actionable": { "score": number, "verdict": "pass" | "fail" },
  "natural": { "score": number, "verdict": "pass" | "fail" }
}`;

function buildUserPrompt(
  draft: WriterOutput,
  profile: LeadProfile,
  agent: AgentProfile
): string {
  return [
    `KNOWN FACTS: ${JSON.stringify(profile)}`,
    `AGENT VOICE: ${JSON.stringify(agent.voice)}`,
    `DRAFT MESSAGE: ${draft.message}`,
  ].join("\n\n");
}

export function makeLlmJudgeFn(config: LlmConfig): JudgeFn {
  return async (
    draft: WriterOutput,
    profile: LeadProfile,
    agent: AgentProfile
  ): Promise<JudgeResult> => {
    const raw = await callLlmJson(
      config,
      SYSTEM_PROMPT,
      buildUserPrompt(draft, profile, agent)
    );
    const parsed = JudgeResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new z.ZodError(parsed.error.issues);
    }
    return parsed.data;
  };
}
