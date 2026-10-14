import type { DeterministicResult } from "./deterministic.js";
import type { LeadProfile } from "./schema.js";
import { EMPTY_LEAD_PROFILE } from "./schema.js";

/**
 * The merge policy, in one place: deterministic (stage 1) wins over the
 * guardrail-verified LLM result whenever both produce a value. Areas,
 * property type and timeline come from the LLM only — the deterministic
 * stage never attempts them. Used by runPipeline and by the in-browser
 * replay, so the simulator cannot drift from the pipeline.
 */
export function mergeProfile(deterministic: DeterministicResult, llmProfile: LeadProfile): LeadProfile {
  return {
    ...EMPTY_LEAD_PROFILE,
    budgetIDR: deterministic.budgetIDR ?? llmProfile.budgetIDR,
    areas: llmProfile.areas,
    intent: deterministic.intent ?? llmProfile.intent,
    urgency: deterministic.urgency ?? llmProfile.urgency,
    propertyType: llmProfile.propertyType,
    timeline: llmProfile.timeline,
  };
}
