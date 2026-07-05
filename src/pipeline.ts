import type { Conversation, LeadProfile } from "./schema.js";
import { EMPTY_LEAD_PROFILE } from "./schema.js";
import { extractDeterministic } from "./deterministic.js";
import { applyGuardrail, type Violation } from "./guardrail.js";
import type { ExtractFn } from "./extract.js";

/**
 * Orchestrates the three stages and applies the merge policy: deterministic
 * (stage 1) wins over the guardrail-verified LLM result (stage 3) whenever
 * both produce a value for the same field.
 *
 * Why deterministic wins on conflict:
 *   - Cheaper: it already ran, for free, before the LLM call.
 *   - Auditable: a regex match points at one exact rule; an LLM call is a
 *     black box even after citation verification.
 *   - Zero-hallucination by construction: a regex either matches the exact
 *     pattern or it doesn't, so there's no failure mode where it invents a
 *     number the lead never said.
 * The LLM stage exists to fill in what regex structurally cannot cover
 * (areas, property type, timeline, and budget/intent/urgency in phrasings
 * the fixed rule set misses) — not to override what regex already nailed.
 */

export interface PipelineResult {
  profile: LeadProfile;
  violations: Violation[];
}

export async function runPipeline(
  conversation: Conversation,
  extractFn: ExtractFn
): Promise<PipelineResult> {
  const deterministic = extractDeterministic(conversation);
  const extraction = await extractFn(conversation);
  const { profile: llmProfile, violations } = applyGuardrail(
    extraction,
    conversation
  );

  const profile: LeadProfile = {
    ...EMPTY_LEAD_PROFILE,
    budgetIDR:
      deterministic.budgetIDR !== null
        ? deterministic.budgetIDR
        : llmProfile.budgetIDR,
    areas: llmProfile.areas,
    intent: deterministic.intent !== null ? deterministic.intent : llmProfile.intent,
    urgency:
      deterministic.urgency !== null ? deterministic.urgency : llmProfile.urgency,
    propertyType: llmProfile.propertyType,
    timeline: llmProfile.timeline,
  };

  return { profile, violations };
}
