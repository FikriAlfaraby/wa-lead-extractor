import { z } from "zod";
import { LeadProfileSchema, LlmExtractionSchema, MessageSchema, WriterOutputSchema } from "./schema.js";

/**
 * Scripted conversations for the simulator (data/scenarios.json) and the
 * recorded model outputs they replay (eval/recordings/*.json).
 *
 * A scenario holds only what a person wrote: the messages, and where the
 * pipeline runs its two model calls ("extract", "draft"). What the models
 * returned lives in a recording, captured once from real calls by
 * eval/record.ts — so every model output the simulator shows can be traced
 * to a run, and the deterministic stages replay it with no network.
 */

export const ScenarioStepSchema = z.discriminatedUnion("type", [
  MessageSchema.extend({ type: z.literal("message") }),
  z.object({ type: z.literal("extract") }),
  z.object({ type: z.literal("draft") }),
]);
export type ScenarioStep = z.infer<typeof ScenarioStepSchema>;

export const ScenarioSchema = z.object({
  id: z.string(),
  title: z.string(),
  blurb: z.string(),
  /** What to look for in the models' runs; every claim in it is checked against the recording by a test. */
  note: z.string().optional(),
  leadName: z.string(),
  agentId: z.string(),
  steps: z.array(ScenarioStepSchema).min(1),
  /**
   * A wrong answer written by hand, to show what the guardrail does with a
   * mistake a model could make. Never presented as a model's output.
   */
  handMade: z.object({ note: z.string(), extraction: LlmExtractionSchema }).optional(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

/** A model reply that could not be read as the schema is recorded as an error, not dropped. */
export const RecordedExtractionSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), extraction: LlmExtractionSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type RecordedExtraction = z.infer<typeof RecordedExtractionSchema>;

export const DraftInputSchema = z.object({
  profile: LeadProfileSchema,
  leadState: z.enum(["new", "warm", "cold"]),
});
export type DraftInput = z.infer<typeof DraftInputSchema>;

export const RecordedDraftSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), writer: z.string(), input: DraftInputSchema, output: WriterOutputSchema }),
  z.object({ ok: z.literal(false), writer: z.string(), input: DraftInputSchema, error: z.string() }),
]);
export type RecordedDraft = z.infer<typeof RecordedDraftSchema>;

/** The hand-made answer's source name in a recording. */
export const HAND_MADE = "hand-made";

export const RecordingSchema = z.object({
  recordedAt: z.string(),
  gateway: z.string(),
  models: z.array(z.string()).min(1),
  /** model -> eval conversation id (data/conversations.json) -> extraction */
  eval: z.record(z.string(), z.record(z.string(), RecordedExtractionSchema)),
  /**
   * scenario id -> source (a model, or HAND_MADE) -> what it produced. The
   * hand-made source has no extraction here (it is in the scenario); a draft
   * is null when the pipeline did not allow one.
   */
  scenarios: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        extraction: RecordedExtractionSchema.nullable(),
        draft: RecordedDraftSchema.nullable(),
      })
    )
  ),
});
export type Recording = z.infer<typeof RecordingSchema>;
