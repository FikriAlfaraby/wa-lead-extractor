import { extractDeterministic, type DeterministicResult } from "@pipeline/deterministic";
import { applyGuardrail, type Violation } from "@pipeline/guardrail";
import { classifyLead, type LeadState } from "@pipeline/classify";
import { qualify, detectExplicitStop, type QualificationState } from "@pipeline/qualify";
import { verifyDraft, type GuardrailVerdict } from "@pipeline/writer-guardrail";
import { EMPTY_LEAD_PROFILE } from "@pipeline/schema";
import type { AgentProfile, Conversation, LeadProfile, LlmExtraction, Message, WriterOutput } from "@pipeline/schema";
import type { Scenario } from "./scenarios";

/**
 * Replays a scenario's steps through the REAL deterministic pipeline code
 * (extractDeterministic, applyGuardrail, classifyLead, qualify,
 * verifyDraft — all imported straight from ../src, unmodified). Nothing
 * here re-implements pipeline logic except the merge policy, which is a
 * direct copy of src/pipeline.ts's "deterministic wins on conflict" rule
 * (pipeline.ts itself isn't imported: it type-depends on extract.ts, which
 * imports the network-calling llm.ts — see ui/vite.config.ts's comment).
 *
 * Recomputes from scratch on every call rather than maintaining incremental
 * state — scenarios are a couple dozen steps, this is cheap, and it avoids
 * an entire class of "state drifted from the steps" bugs.
 */

export interface FactCitations {
  budgetIDR: string | null;
  areas: string[];
  intent: string | null;
  urgency: string | null;
  propertyType: string | null;
  timeline: string | null;
}

const NO_CITATIONS: FactCitations = {
  budgetIDR: null,
  areas: [],
  intent: null,
  urgency: null,
  propertyType: null,
  timeline: null,
};

export interface Transition {
  state: QualificationState;
  reason: string;
}

export interface DraftResult {
  output: WriterOutput;
  verdict: GuardrailVerdict;
}

export interface SimState {
  conversation: Conversation;
  profile: LeadProfile;
  citations: FactCitations;
  violations: Violation[];
  extractionNote: string | null;
  leadState: LeadState;
  qualState: QualificationState;
  transitions: Transition[];
  draft: DraftResult | null;
  isComplete: boolean;
}

// Mirrors src/pipeline.ts's runPipeline() merge policy exactly: deterministic
// wins on conflict for the fields it can produce; areas/propertyType/timeline
// are LLM-only fields deterministic never attempts.
function mergeProfile(det: DeterministicResult, llmProfile: LeadProfile): LeadProfile {
  return {
    ...EMPTY_LEAD_PROFILE,
    budgetIDR: det.budgetIDR ?? llmProfile.budgetIDR,
    areas: llmProfile.areas,
    intent: det.intent ?? llmProfile.intent,
    urgency: det.urgency ?? llmProfile.urgency,
    propertyType: llmProfile.propertyType,
    timeline: llmProfile.timeline,
  };
}

function mergeCitations(det: DeterministicResult, llmCitations: FactCitations): FactCitations {
  return {
    budgetIDR: det.budgetIDR !== null ? det.budgetCitation : llmCitations.budgetIDR,
    areas: llmCitations.areas,
    intent: det.intent !== null ? det.intentCitation : llmCitations.intent,
    urgency: det.urgency !== null ? det.urgencyCitation : llmCitations.urgency,
    propertyType: llmCitations.propertyType,
    timeline: llmCitations.timeline,
  };
}

function fieldHasViolation(violations: Violation[], field: string): boolean {
  return violations.some((v) => v.field === field);
}

// Recovers, per-field, which citation survived applyGuardrail — the
// guardrail's own return value only carries the final values, not which
// citation backed each one, and the simulator needs that citation text to
// let a click on a fact scroll to and highlight its source message.
function extractLlmCitations(extraction: LlmExtraction, violations: Violation[]): FactCitations {
  const areasCitations: string[] = [];
  extraction.areas.value.forEach((_, i) => {
    if (!fieldHasViolation(violations, `areas[${i}]`)) {
      areasCitations.push(extraction.areas.citations[i] ?? "");
    }
  });

  const scalarCitation = (
    field: "budgetIDR" | "intent" | "urgency" | "propertyType" | "timeline",
    value: unknown,
    citation: string | null
  ): string | null => {
    if (value === null || value === "unknown") return null;
    return fieldHasViolation(violations, field) ? null : citation;
  };

  return {
    budgetIDR: scalarCitation("budgetIDR", extraction.budgetIDR.value, extraction.budgetIDR.citation),
    areas: areasCitations,
    intent: scalarCitation("intent", extraction.intent.value, extraction.intent.citation),
    urgency: scalarCitation("urgency", extraction.urgency.value, extraction.urgency.citation),
    propertyType: scalarCitation("propertyType", extraction.propertyType.value, extraction.propertyType.citation),
    timeline: scalarCitation("timeline", extraction.timeline.value, extraction.timeline.citation),
  };
}

export function runSimulation(scenario: Scenario, agent: AgentProfile, uptoStep: number): SimState {
  const messages: Message[] = [];
  let llmProfile: LeadProfile = { ...EMPTY_LEAD_PROFILE };
  let llmCitations: FactCitations = { ...NO_CITATIONS };
  let violations: Violation[] = [];
  let extractionNote: string | null = null;
  let qualState: QualificationState = "new";
  const transitions: Transition[] = [];
  let draft: DraftResult | null = null;

  const recordTransition = (result: { state: QualificationState; reason: string }) => {
    if (result.state !== qualState || transitions.length === 0) {
      transitions.push({ state: result.state, reason: result.reason });
    }
    qualState = result.state;
  };

  const visibleSteps = scenario.steps.slice(0, uptoStep + 1);

  for (const step of visibleSteps) {
    if (step.type === "message") {
      messages.push({ speaker: step.speaker, text: step.text });
    } else if (step.type === "llm_extraction") {
      const conversation: Conversation = { id: scenario.id, messages };
      const result = applyGuardrail(step.extraction, conversation);
      llmProfile = result.profile;
      violations = result.violations;
      llmCitations = extractLlmCitations(step.extraction, result.violations);
      extractionNote = step.note ?? null;
    } else if (step.type === "llm_draft") {
      const conversation: Conversation = { id: scenario.id, messages };
      const profile = mergeProfile(extractDeterministic(conversation), llmProfile);
      draft = { output: step.draft, verdict: verifyDraft(step.draft, profile, agent) };
    }

    const conversation: Conversation = { id: scenario.id, messages };
    const det = extractDeterministic(conversation);
    const profile = mergeProfile(det, llmProfile);
    const stop = detectExplicitStop(conversation);
    recordTransition(qualify(qualState, profile, { explicitStop: stop }));
  }

  const conversation: Conversation = { id: scenario.id, messages };
  const det = extractDeterministic(conversation);
  const profile = mergeProfile(det, llmProfile);
  const citations = mergeCitations(det, llmCitations);

  const firstLeadAt = messages.find((m) => m.speaker === "lead") ? new Date().toISOString() : null;
  const leadState: LeadState = firstLeadAt
    ? classifyLead({
        conversation,
        lastLeadMessageAt: new Date().toISOString(),
        firstContactAt: firstLeadAt,
        now: new Date().toISOString(),
      })
    : "new";

  return {
    conversation,
    profile,
    citations,
    violations,
    extractionNote,
    leadState,
    qualState,
    transitions,
    draft,
    isComplete: uptoStep >= scenario.steps.length - 1,
  };
}

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Finds which message a citation was drawn from, for click-to-highlight. */
export function findMessageIndex(messages: Message[], citation: string | null): number | null {
  if (!citation) return null;
  const needle = normalize(citation);
  if (needle.length === 0) return null;
  const idx = messages.findIndex((m) => normalize(m.text).includes(needle));
  return idx === -1 ? null : idx;
}
