import { z } from "zod";
import type { Conversation } from "./schema.js";
import { LlmExtractionSchema, type LlmExtraction } from "./schema.js";
import { callLlmJson, type LlmConfig } from "./llm.js";

/**
 * Stage 2: single LLM call that extracts the fields deterministic regex
 * can't reliably cover (areas, property type, timeline) plus a second
 * opinion on budget/intent/urgency. Every field is cite-or-null: the model
 * is instructed to return `null` rather than infer, and to always attach a
 * verbatim quote. The guardrail (stage 3) treats this output as untrusted
 * and independently re-verifies every citation — this prompt is a strong
 * suggestion to the model, not a security boundary.
 */

const SYSTEM_PROMPT = `You extract structured lead facts from a WhatsApp conversation between a property agent and a lead, for the Southeast Asian property market (Jakarta/BSD/Singapore).

STRICT RULES:
1. Extract ONLY facts explicitly stated by the LEAD. Never use facts stated only by the agent or about a third party (e.g. a friend's budget).
2. Every non-null field MUST include a "citation" that is a VERBATIM, EXACT substring copied from the lead's own message. Do not paraphrase, translate, or summarize the citation.
3. If a fact is not explicitly and unambiguously stated by the lead, set its value to null and its citation to null. NEVER infer, guess, or fill in a plausible-sounding value.
4. Respond with ONLY a single JSON object matching the schema below. No prose, no markdown fences.

SCHEMA:
{
  "budgetIDR": { "value": number | null, "citation": string | null },
  "areas": { "value": string[], "citations": string[] },
  "intent": { "value": "buy" | "rent" | "unknown" | null, "citation": string | null },
  "urgency": { "value": "high" | "medium" | "low" | "unknown" | null, "citation": string | null },
  "propertyType": { "value": string | null, "citation": string | null },
  "timeline": { "value": string | null, "citation": string | null }
}`;

function formatTranscript(conversation: Conversation): string {
  return conversation.messages
    .map((m) => `${m.speaker.toUpperCase()}: ${m.text}`)
    .join("\n");
}

export type ExtractFn = (conversation: Conversation) => Promise<LlmExtraction>;

export function makeLlmExtractFn(config: LlmConfig): ExtractFn {
  return async (conversation: Conversation): Promise<LlmExtraction> => {
    const transcript = formatTranscript(conversation);
    const raw = await callLlmJson(
      config,
      SYSTEM_PROMPT,
      `Conversation:\n${transcript}`
    );

    const parsed = LlmExtractionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new z.ZodError(parsed.error.issues);
    }
    return parsed.data;
  };
}
