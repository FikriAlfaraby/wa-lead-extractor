import type { Conversation } from "./schema.js";

/**
 * Lead-state classification: deterministic, no LLM. Same philosophy as
 * deterministic.ts — this decision gates a money action (who gets a
 * follow-up and how it's worded), so it needs to be cheap, instant, and
 * auditable against one exact rule, not a model call.
 *
 * `now` is always injected by the caller, never read from Date.now() here,
 * so the rules stay pure and testable with a fixed clock.
 */

export type LeadState = "new" | "warm" | "cold";

// Thresholds, named so a rule change is a one-line diff, not an archaeology
// exercise.
export const WARM_REPLY_WINDOW_DAYS = 7;
export const COLD_SILENCE_WINDOW_DAYS = 14;
export const NEW_LEAD_MAX_MESSAGES = 3;
export const NEW_LEAD_MAX_AGE_HOURS = 48;

export interface ClassifyInput {
  conversation: Conversation;
  /** ISO timestamp of the lead's most recent message. */
  lastLeadMessageAt: string;
  /** ISO timestamp of the lead's first message ever (defines lead age). */
  firstContactAt: string;
  /** ISO timestamp of "now", injected by the caller. */
  now: string;
}

function hoursBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60);
}

function daysBetween(fromIso: string, toIso: string): number {
  return hoursBetween(fromIso, toIso) / 24;
}

export function classifyLead(input: ClassifyInput): LeadState {
  const { conversation, lastLeadMessageAt, firstContactAt, now } = input;

  const totalLeadMessages = conversation.messages.filter(
    (m) => m.speaker === "lead"
  ).length;
  const ageHours = hoursBetween(firstContactAt, now);
  const isFirstContact =
    totalLeadMessages < NEW_LEAD_MAX_MESSAGES && ageHours < NEW_LEAD_MAX_AGE_HOURS;

  // "new" takes priority: a brand-new lead is a distinct treatment even
  // though it would also technically fall inside the warm reply window.
  if (isFirstContact) return "new";

  const daysSinceLastReply = daysBetween(lastLeadMessageAt, now);

  if (daysSinceLastReply > COLD_SILENCE_WINDOW_DAYS) return "cold";
  if (daysSinceLastReply <= WARM_REPLY_WINDOW_DAYS) return "warm";

  // ponytail: 7-14 day gap isn't specified by the rules above. Default to
  // "cold" — safer to re-open softly on a stale lead than to assume warm
  // rapport that has actually cooled. Revisit if data shows this band needs
  // its own treatment.
  return "cold";
}
