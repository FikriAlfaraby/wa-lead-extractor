import type { Conversation } from "./schema.js";
import type { LlmExtraction } from "./schema.js";
import type { LeadProfile } from "./schema.js";
import { EMPTY_LEAD_PROFILE } from "./schema.js";

/**
 * Stage 3: the cite-or-null guardrail. Pure function, no network.
 *
 * For every field the LLM claimed a value for, this independently
 * re-verifies that the citation is a real, verbatim substring of one of
 * the LEAD's own messages (never the agent's). If verification fails for
 * any reason — missing citation, fabricated text, or citation sourced from
 * an agent message — the field is nulled out and a violation is recorded.
 *
 * This is the one guarantee the whole system rests on: whatever survives
 * this stage is traceable to an exact quote the lead actually said.
 */

export interface Violation {
  field: string;
  reason: "missing_citation" | "citation_not_found" | "citation_from_agent";
  citation: string | null;
}

export interface GuardrailResult {
  profile: LeadProfile;
  violations: Violation[];
}

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function citationFoundInLeadMessages(
  citation: string,
  conversation: Conversation
): boolean {
  const normalizedCitation = normalize(citation);
  if (normalizedCitation.length === 0) return false;
  return conversation.messages.some(
    (m) =>
      m.speaker === "lead" && normalize(m.text).includes(normalizedCitation)
  );
}

function citationFoundInAgentMessages(
  citation: string,
  conversation: Conversation
): boolean {
  const normalizedCitation = normalize(citation);
  if (normalizedCitation.length === 0) return false;
  return conversation.messages.some(
    (m) =>
      m.speaker === "agent" && normalize(m.text).includes(normalizedCitation)
  );
}

function verifyCitation(
  field: string,
  citation: string | null,
  conversation: Conversation,
  violations: Violation[]
): boolean {
  if (!citation || citation.trim().length === 0) {
    violations.push({ field, reason: "missing_citation", citation: null });
    return false;
  }
  if (citationFoundInLeadMessages(citation, conversation)) {
    return true;
  }
  if (citationFoundInAgentMessages(citation, conversation)) {
    violations.push({
      field,
      reason: "citation_from_agent",
      citation,
    });
    return false;
  }
  violations.push({ field, reason: "citation_not_found", citation });
  return false;
}

export function applyGuardrail(
  extraction: LlmExtraction,
  conversation: Conversation
): GuardrailResult {
  const violations: Violation[] = [];
  const profile: LeadProfile = { ...EMPTY_LEAD_PROFILE };

  if (
    extraction.budgetIDR.value !== null &&
    verifyCitation(
      "budgetIDR",
      extraction.budgetIDR.citation,
      conversation,
      violations
    )
  ) {
    profile.budgetIDR = extraction.budgetIDR.value;
  }

  if (extraction.areas.value.length > 0) {
    const verifiedAreas: string[] = [];
    extraction.areas.value.forEach((area, index) => {
      const citation = extraction.areas.citations[index] ?? null;
      if (verifyCitation(`areas[${index}]`, citation, conversation, violations)) {
        verifiedAreas.push(area);
      }
    });
    profile.areas = verifiedAreas;
  }

  if (
    extraction.intent.value !== null &&
    extraction.intent.value !== "unknown" &&
    verifyCitation(
      "intent",
      extraction.intent.citation,
      conversation,
      violations
    )
  ) {
    profile.intent = extraction.intent.value;
  }

  if (
    extraction.urgency.value !== null &&
    extraction.urgency.value !== "unknown" &&
    verifyCitation(
      "urgency",
      extraction.urgency.citation,
      conversation,
      violations
    )
  ) {
    profile.urgency = extraction.urgency.value;
  }

  if (
    extraction.propertyType.value !== null &&
    verifyCitation(
      "propertyType",
      extraction.propertyType.citation,
      conversation,
      violations
    )
  ) {
    profile.propertyType = extraction.propertyType.value;
  }

  if (
    extraction.timeline.value !== null &&
    verifyCitation(
      "timeline",
      extraction.timeline.citation,
      conversation,
      violations
    )
  ) {
    profile.timeline = extraction.timeline.value;
  }

  return { profile, violations };
}
