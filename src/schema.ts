import { z } from "zod";

/**
 * A conversation is a transcript of WhatsApp messages between a property
 * agent and a lead. Order matters; speaker attribution is required because
 * the guardrail must reject citations pulled from the agent's own messages
 * (the "agent-voice trap": the agent floats a number, the lead never
 * confirms it, and a naive extractor happily "extracts" the agent's words).
 */
export const MessageSchema = z.object({
  speaker: z.enum(["lead", "agent"]),
  text: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  messages: z.array(MessageSchema).min(1),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const IntentSchema = z.enum(["buy", "rent", "unknown"]);
export type Intent = z.infer<typeof IntentSchema>;

export const UrgencySchema = z.enum(["high", "medium", "low", "unknown"]);
export type Urgency = z.infer<typeof UrgencySchema>;

/**
 * Every LLM-extracted field carries a verbatim citation: an exact substring
 * of the transcript that supports the value. No citation, no value. This is
 * the single mechanism the whole "cite-or-null" guardrail hangs off of.
 */
export const CitedFieldSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    citation: z.string().nullable(),
  });

export const LlmExtractionSchema = z.object({
  budgetIDR: CitedFieldSchema(z.number()),
  areas: z.object({
    // LLMs often return null instead of [] when no areas are mentioned —
    // be lenient at the parsing boundary, normalize to an empty array
    value: z
      .array(z.string())
      .nullable()
      .transform((v) => v ?? []),
    citations: z
      .array(z.string())
      .nullable()
      .transform((v) => v ?? []),
  }),
  intent: CitedFieldSchema(IntentSchema),
  urgency: CitedFieldSchema(UrgencySchema),
  propertyType: CitedFieldSchema(z.string()),
  timeline: CitedFieldSchema(z.string()),
});
export type LlmExtraction = z.infer<typeof LlmExtractionSchema>;

/**
 * The final, flattened lead profile shape used by golden data, eval
 * comparisons, and downstream consumers. Citations are stripped here on
 * purpose — this is the "public" output shape; internal stages keep
 * citations around only as long as they're needed for verification.
 */
export const LeadProfileSchema = z.object({
  budgetIDR: z.number().nullable(),
  areas: z.array(z.string()),
  intent: IntentSchema,
  urgency: UrgencySchema,
  propertyType: z.string().nullable(),
  timeline: z.string().nullable(),
});
export type LeadProfile = z.infer<typeof LeadProfileSchema>;

export const EMPTY_LEAD_PROFILE: LeadProfile = {
  budgetIDR: null,
  areas: [],
  intent: "unknown",
  urgency: "unknown",
  propertyType: null,
  timeline: null,
};

/**
 * A per-agent style profile (data/agents.json). Drives the writer prompt
 * and the writer guardrail — voice constraints are enforced mechanically,
 * not just requested in the prompt, same "don't trust the LLM to follow
 * instructions" posture as the extraction guardrail.
 */
export const AgentProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  voice: z.object({
    tone: z.enum(["warm-professional", "casual-direct"]),
    language: z.enum(["en-sg", "id"]),
    signOff: z.string(),
    emojiPolicy: z.enum(["none", "sparing"]),
    maxSentences: z.number().int().positive(),
  }),
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
