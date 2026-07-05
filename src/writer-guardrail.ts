import type { AgentProfile, LeadProfile } from "./schema.js";
import type { WriterOutput } from "./writer.js";

/**
 * Verifies a drafted message before it's allowed anywhere near a "send"
 * button. Pure function, no network — this is stage 3 for the writer, the
 * same role guardrail.ts plays for extraction: the LLM prompt is a strong
 * suggestion, this is the actual boundary.
 *
 * Two different guardrail designs for two different failure modes:
 *   - extraction guardrail verifies a CITATION exists verbatim in the
 *     transcript (the risk is inventing what the lead said).
 *   - writer guardrail verifies every FACT IN THE OUTPUT exists in the
 *     already-verified profile (the risk is inventing what the agent says
 *     back — a price, a listing, an area nobody confirmed).
 */

export interface GuardrailVerdict {
  passed: boolean;
  violations: string[];
}

// ponytail: numbers below this are treated as incidental (times, unit
// counts, "2 units left") rather than facts that need grounding in the
// profile. Only larger numbers (money-shaped) are checked against the
// budget. Raise/lower if false positives/negatives show up in practice.
const MIN_FLAGGED_NUMBER = 10;

// ponytail: small hardcoded gazetteer instead of NER/entity linking. Good
// enough to catch an invented area in a work sample; a real system needs
// proper location entity extraction to cover areas outside this list.
const KNOWN_AREA_TERMS = [
  "BSD",
  "Jaksel",
  "Kemang",
  "Alam Sutera",
  "Bintaro",
  "District 9",
  "District 10",
  "Singapore",
  "Jakarta",
];

function allowedBudgetNumbers(profile: LeadProfile): number[] {
  if (profile.budgetIDR === null) return [];
  return [
    profile.budgetIDR,
    profile.budgetIDR / 1_000_000, // "900" in "900 million"
    profile.budgetIDR / 1_000_000_000, // "0.9" in "0.9 billion"
  ];
}

function isCloseToAny(value: number, allowed: number[]): boolean {
  return allowed.some((a) => Math.abs(a - value) < 0.05);
}

function findInventedNumbers(message: string, profile: LeadProfile): string[] {
  const allowed = allowedBudgetNumbers(profile);
  const matches = message.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const violations: string[] = [];
  for (const raw of matches) {
    const value = parseFloat(raw.replace(/,/g, ""));
    if (Number.isNaN(value) || value < MIN_FLAGGED_NUMBER) continue;
    if (!isCloseToAny(value, allowed)) {
      violations.push(`number "${raw}" not grounded in the lead profile`);
    }
  }
  return violations;
}

function findInventedAreas(message: string, profile: LeadProfile): string[] {
  const lowerMessage = message.toLowerCase();
  const knownAreas = new Set(profile.areas.map((a) => a.toLowerCase()));
  const violations: string[] = [];
  for (const term of KNOWN_AREA_TERMS) {
    if (lowerMessage.includes(term.toLowerCase()) && !knownAreas.has(term.toLowerCase())) {
      violations.push(`area "${term}" not present in the lead profile`);
    }
  }
  return violations;
}

const SENTENCE_END = /[.!?]+(?=\s|$)/g;

function countSentences(message: string): number {
  const matches = message.match(SENTENCE_END);
  if (matches) return matches.length;
  return message.trim().length > 0 ? 1 : 0;
}

const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;

function countEmoji(message: string): number {
  return (message.match(EMOJI_REGEX) ?? []).length;
}

export function verifyDraft(
  draft: WriterOutput,
  profile: LeadProfile,
  agent: AgentProfile
): GuardrailVerdict {
  const violations: string[] = [
    ...findInventedNumbers(draft.message, profile),
    ...findInventedAreas(draft.message, profile),
  ];

  const sentenceCount = countSentences(draft.message);
  if (sentenceCount > agent.voice.maxSentences) {
    violations.push(
      `message has ${sentenceCount} sentences, exceeds agent max of ${agent.voice.maxSentences}`
    );
  }

  const emojiCount = countEmoji(draft.message);
  const emojiLimit = agent.voice.emojiPolicy === "none" ? 0 : 1;
  if (emojiCount > emojiLimit) {
    violations.push(
      `message has ${emojiCount} emoji, exceeds agent policy "${agent.voice.emojiPolicy}" (limit ${emojiLimit})`
    );
  }

  return { passed: violations.length === 0, violations };
}
