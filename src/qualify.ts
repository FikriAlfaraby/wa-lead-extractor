import type { Conversation, LeadProfile } from "./schema.js";

/**
 * Qualification state machine: deterministic core, same reasoning as
 * classify.ts (auditability, cost, latency for a decision that gates a
 * money action). Implemented as a pure reducer — (state, profile, signals)
 * -> {state, reason} — so every transition is a one-line, testable fact and
 * the caller decides when to re-run it (e.g. after every new message).
 *
 * States: new -> qualifying -> qualified | disqualified | handed_off.
 * disqualified and handed_off are terminal: once a lead is there, further
 * calls are no-ops (an already-handed-off lead doesn't get re-qualified by
 * this function; that's a human/CRM decision now).
 */

export type QualificationState =
  | "new"
  | "qualifying"
  | "qualified"
  | "disqualified"
  | "handed_off";

export interface QualifySignals {
  /** Lead explicitly said stop/not interested (keyword-detected). */
  explicitStop: boolean;
}

export interface QualifyResult {
  state: QualificationState;
  reason: string;
}

// A budget this far below the cheapest thing we sell isn't a soft-qualify
// case, it's a mismatch — disqualify rather than burn follow-ups on it.
export const LISTING_FLOOR_IDR = 100_000_000;
export const BUDGET_FAR_BELOW_RATIO = 0.5;

const STOP_KEYWORDS = [
  "stop",
  "berhenti",
  "tidak tertarik",
  "gak minat",
  "ga minat",
  "not interested",
  "unsubscribe",
];

/** Helper for callers: derive the explicitStop signal from the transcript. */
export function detectExplicitStop(conversation: Conversation): boolean {
  return conversation.messages.some(
    (m) =>
      m.speaker === "lead" &&
      STOP_KEYWORDS.some((kw) => m.text.toLowerCase().includes(kw))
  );
}

/**
 * Whether the writer may draft a follow-up for a lead in this state. A
 * disqualified lead gets no message: the writer is never told that the lead
 * said stop, so this gate, not the prompt, is what keeps it from writing one.
 */
export function draftAllowed(state: QualificationState): boolean {
  return state !== "disqualified";
}

function isTerminal(state: QualificationState): boolean {
  return state === "disqualified" || state === "handed_off";
}

function hasAnyProfileSignal(profile: LeadProfile): boolean {
  return (
    profile.budgetIDR !== null ||
    profile.areas.length > 0 ||
    profile.intent !== "unknown" ||
    profile.urgency !== "unknown" ||
    profile.propertyType !== null ||
    profile.timeline !== null
  );
}

function meetsQualifiedBar(profile: LeadProfile): boolean {
  return (
    profile.budgetIDR !== null &&
    profile.intent !== "unknown" &&
    profile.areas.length > 0
  );
}

export function qualify(
  state: QualificationState,
  profile: LeadProfile,
  signals: QualifySignals
): QualifyResult {
  if (isTerminal(state)) {
    return { state, reason: `already in terminal state "${state}"` };
  }

  if (signals.explicitStop) {
    return { state: "disqualified", reason: "lead explicitly said stop/not interested" };
  }

  if (
    profile.budgetIDR !== null &&
    profile.budgetIDR < LISTING_FLOOR_IDR * BUDGET_FAR_BELOW_RATIO
  ) {
    return {
      state: "disqualified",
      reason: `budget ${profile.budgetIDR} is far below the listing floor (${LISTING_FLOOR_IDR})`,
    };
  }

  if (meetsQualifiedBar(profile)) {
    if (profile.urgency === "high") {
      return {
        state: "handed_off",
        reason: "qualified (budget, intent, area present) with high urgency — handed off to agent",
      };
    }
    return {
      state: "qualified",
      reason: "budget, intent, and at least one area are all present",
    };
  }

  if (state === "new" && hasAnyProfileSignal(profile)) {
    return { state: "qualifying", reason: "some lead facts collected but qualified bar not yet met" };
  }

  if (state === "new") {
    return { state: "new", reason: "no lead facts extracted yet" };
  }

  return { state: "qualifying", reason: "still missing budget, intent, or area for the qualified bar" };
}
