import { classifyLead, type LeadState } from "./classify.js";
import { extractDeterministic, type DeterministicResult } from "./deterministic.js";
import { applyGuardrail, type Violation } from "./guardrail.js";
import { mergeProfile } from "./merge.js";
import { detectExplicitStop, draftAllowed, qualify, type QualificationState } from "./qualify.js";
import { HAND_MADE, type DraftInput, type Recording, type Scenario } from "./scenario.js";
import { EMPTY_LEAD_PROFILE } from "./schema.js";
import type { AgentProfile, Conversation, LeadProfile, LlmExtraction, Message, WriterOutput } from "./schema.js";
import { verifyDraft, type GuardrailVerdict } from "./writer-guardrail.js";

/**
 * Replays a scenario through the real deterministic stages — deterministic
 * extraction, the citation guardrail, the merge, classification,
 * qualification, the draft gate and the writer guardrail — with the model
 * outputs supplied by the caller (a recording, or a hand-made answer).
 * No network: this is what runs in the browser on fikrialfaraby.com, and
 * what eval/record.ts uses to compute the writer's input, so the two
 * cannot disagree.
 *
 * Recomputes from scratch on every call rather than keeping incremental
 * state: scenarios are a couple dozen steps, and it rules out state that
 * drifts from the steps.
 */

/** Every classification in a replay uses this one instant, so a replay is deterministic. */
export const REPLAY_NOW = "2026-10-14T03:00:00.000Z";

export interface ReplayOutputs {
  /** What the model returned at the extract step; null when its reply could not be read. */
  extraction: LlmExtraction | null;
  /** What the writer returned at the draft step; null when its reply could not be read. */
  draft: WriterOutput | null;
}

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

export type ExtractionStatus = "pending" | "read" | "unreadable";

export type DraftState =
  | { status: "written"; output: WriterOutput; verdict: GuardrailVerdict }
  | { status: "blocked"; reason: string }
  | { status: "unreadable" };

export interface SimState {
  conversation: Conversation;
  profile: LeadProfile;
  citations: FactCitations;
  violations: Violation[];
  extractionStatus: ExtractionStatus;
  leadState: LeadState;
  qualState: QualificationState;
  transitions: Transition[];
  draft: DraftState | null;
  /** What the writer is given at the draft step (null before it, or when drafting is blocked). */
  draftInput: DraftInput | null;
  isComplete: boolean;
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

// applyGuardrail returns the surviving values, not which citation backed
// each one; the simulator needs that text so a click on a fact can scroll to
// and highlight its source message.
function survivingCitations(extraction: LlmExtraction, violations: Violation[]): FactCitations {
  const areas: string[] = [];
  extraction.areas.value.forEach((_, i) => {
    if (!fieldHasViolation(violations, `areas[${i}]`)) areas.push(extraction.areas.citations[i] ?? "");
  });

  const scalar = (
    field: "budgetIDR" | "intent" | "urgency" | "propertyType" | "timeline",
    value: unknown,
    citation: string | null
  ): string | null => {
    if (value === null || value === "unknown") return null;
    return fieldHasViolation(violations, field) ? null : citation;
  };

  return {
    budgetIDR: scalar("budgetIDR", extraction.budgetIDR.value, extraction.budgetIDR.citation),
    areas,
    intent: scalar("intent", extraction.intent.value, extraction.intent.citation),
    urgency: scalar("urgency", extraction.urgency.value, extraction.urgency.citation),
    propertyType: scalar("propertyType", extraction.propertyType.value, extraction.propertyType.citation),
    timeline: scalar("timeline", extraction.timeline.value, extraction.timeline.citation),
  };
}

function leadStateOf(conversation: Conversation, now: string): LeadState {
  if (!conversation.messages.some((m) => m.speaker === "lead")) return "new";
  return classifyLead({ conversation, lastLeadMessageAt: now, firstContactAt: now, now });
}

export function runSimulation(
  scenario: Scenario,
  agent: AgentProfile,
  uptoStep: number,
  outputs: ReplayOutputs,
  now: string = REPLAY_NOW
): SimState {
  const messages: Message[] = [];
  const conversationSoFar = (): Conversation => ({
    id: scenario.id,
    messages: [...messages],
    ...(scenario.market ? { market: scenario.market } : {}),
  });
  let llmProfile: LeadProfile = { ...EMPTY_LEAD_PROFILE };
  let llmCitations: FactCitations = { ...NO_CITATIONS };
  let violations: Violation[] = [];
  let extractionStatus: ExtractionStatus = "pending";
  let qualState: QualificationState = "new";
  const transitions: Transition[] = [];
  let draft: DraftState | null = null;
  let draftInput: DraftInput | null = null;

  for (const step of scenario.steps.slice(0, uptoStep + 1)) {
    if (step.type === "message") {
      messages.push({ speaker: step.speaker, text: step.text });
    } else if (step.type === "extract") {
      if (outputs.extraction) {
        const result = applyGuardrail(outputs.extraction, conversationSoFar());
        llmProfile = result.profile;
        violations = result.violations;
        llmCitations = survivingCitations(outputs.extraction, result.violations);
        extractionStatus = "read";
      } else {
        extractionStatus = "unreadable";
      }
    } else if (!draftAllowed(qualState)) {
      draft = { status: "blocked", reason: transitions[transitions.length - 1]?.reason ?? qualState };
    } else {
      const conversation = conversationSoFar();
      const profile = mergeProfile(extractDeterministic(conversation), llmProfile);
      draftInput = { profile, leadState: leadStateOf(conversation, now) };
      draft = outputs.draft
        ? { status: "written", output: outputs.draft, verdict: verifyDraft(outputs.draft, profile, agent) }
        : { status: "unreadable" };
    }

    const conversation = conversationSoFar();
    const profile = mergeProfile(extractDeterministic(conversation), llmProfile);
    const result = qualify(qualState, profile, { explicitStop: detectExplicitStop(conversation) });
    if (result.state !== qualState || transitions.length === 0) transitions.push(result);
    qualState = result.state;
  }

  const conversation = conversationSoFar();
  const det = extractDeterministic(conversation);

  return {
    conversation,
    profile: mergeProfile(det, llmProfile),
    citations: mergeCitations(det, llmCitations),
    violations,
    extractionStatus,
    leadState: leadStateOf(conversation, now),
    qualState,
    transitions,
    draft,
    draftInput,
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

/** The part of a recording the simulator needs; the eval runs stay out of the browser bundle. */
export type ScenarioRecording = Pick<Recording, "recordedAt" | "gateway" | "models" | "scenarios">;

/** The sources a recording holds for a scenario: each model, then the hand-made answer if there is one. */
export function sourcesFor(recording: ScenarioRecording, scenario: Scenario): string[] {
  const recorded = Object.keys(recording.scenarios[scenario.id] ?? {});
  return [...recording.models.filter((m) => recorded.includes(m)), ...recorded.filter((s) => s === HAND_MADE)];
}

/** What one source produced for a scenario, ready to replay. */
export function outputsFor(recording: ScenarioRecording, scenario: Scenario, source: string): ReplayOutputs {
  const recorded = recording.scenarios[scenario.id]?.[source];
  if (!recorded) throw new Error(`the recording has no "${source}" run of scenario "${scenario.id}"`);
  let extraction: LlmExtraction | null;
  if (source === HAND_MADE) {
    if (!scenario.handMade) throw new Error(`scenario "${scenario.id}" has no hand-made answer`);
    extraction = scenario.handMade.extraction;
  } else {
    extraction = recorded.extraction?.ok ? recorded.extraction.extraction : null;
  }
  return { extraction, draft: recorded.draft?.ok ? recorded.draft.output : null };
}
