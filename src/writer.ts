import { z } from "zod";
import { WriterOutputSchema, type AgentProfile, type LeadProfile, type WriterOutput } from "./schema.js";
import type { LeadState } from "./classify.js";
import { callLlmJson, type LlmConfig } from "./llm.js";

/**
 * Generates one re-engagement WhatsApp message for a lead. LLM stage —
 * writing needs nuance and voice, which is exactly what deterministic rules
 * are bad at. The output is never trusted blindly: writer-guardrail.ts
 * re-verifies it afterwards, the same "LLM stage sandwiched by deterministic
 * validation" pattern as extract.ts -> guardrail.ts.
 */

// WriterOutputSchema/WriterOutput now live in schema.ts (writer-guardrail.ts
// needs the type without pulling in this file's llm.ts/openai dependency);
// re-exported here so existing `from "./writer.js"` imports keep working.
export type { WriterOutput };

export interface WriterInput {
  profile: LeadProfile;
  leadState: LeadState;
  agent: AgentProfile;
}

export type WriteFn = (input: WriterInput) => Promise<WriterOutput>;

function describeProfile(profile: LeadProfile): string {
  const facts: string[] = [];
  if (profile.budgetIDR !== null) facts.push(`budget: ${profile.budgetIDR} IDR`);
  if (profile.areas.length > 0) facts.push(`areas: ${profile.areas.join(", ")}`);
  if (profile.intent !== "unknown") facts.push(`intent: ${profile.intent}`);
  if (profile.urgency !== "unknown") facts.push(`urgency: ${profile.urgency}`);
  if (profile.propertyType !== null) facts.push(`property type: ${profile.propertyType}`);
  if (profile.timeline !== null) facts.push(`timeline: ${profile.timeline}`);
  return facts.length > 0 ? facts.join("\n") : "(no facts known about this lead yet)";
}

const SYSTEM_PROMPT = `You write a single WhatsApp re-engagement message from a property agent to a lead, for the Southeast Asian property market.

STRICT RULES:
1. You may ONLY reference facts explicitly listed in "KNOWN FACTS" below. Never invent a listing, price, availability, or any other detail not given to you.
2. Match the agent's voice exactly: the given tone, language, emoji policy, sign-off, and max sentence count.
3. The message must contain exactly ONE clear call to action.
4. If the lead state is "cold", re-open softly (they've gone quiet — don't pressure). If "warm", propose a concrete next step (they're actively engaged). If "new", welcome them and ask a light qualifying question.
5. Respond with ONLY a single JSON object: { "message": string, "factsUsed": string[] }. "factsUsed" lists which of the KNOWN FACTS lines were referenced. No prose, no markdown fences.`;

function buildUserPrompt(input: WriterInput): string {
  const { profile, leadState, agent } = input;
  return [
    `LEAD STATE: ${leadState}`,
    `KNOWN FACTS:\n${describeProfile(profile)}`,
    `AGENT VOICE: tone=${agent.voice.tone}, language=${agent.voice.language}, emojiPolicy=${agent.voice.emojiPolicy}, maxSentences=${agent.voice.maxSentences}, signOff="${agent.voice.signOff}"`,
  ].join("\n\n");
}

export function makeLlmWriteFn(config: LlmConfig): WriteFn {
  return async (input: WriterInput): Promise<WriterOutput> => {
    const raw = await callLlmJson(config, SYSTEM_PROMPT, buildUserPrompt(input));
    const parsed = WriterOutputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new z.ZodError(parsed.error.issues);
    }
    return parsed.data;
  };
}
