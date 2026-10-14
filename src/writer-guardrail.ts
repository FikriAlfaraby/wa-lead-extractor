import type { AgentProfile, LeadProfile, WriterOutput } from "./schema.js";
import {
  normalizeIndonesianNumber,
  JUTA_MULTIPLIER,
  MILIAR_MULTIPLIER,
  MONEY_UNIT_MULTIPLIERS,
} from "./deterministic.js";

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

/** Units after a number that make it a duration or a count, not a fact about the lead. */
const NOT_A_FACT_UNIT =
  /^\s*-?\s*(minutes?|mins?|menit|hours?|hrs?|jam|days?|hari|weeks?|months?|bulan|years?|tahun|seconds?|detik|units?|pcs|bedrooms?|br|kt|kamar|percent|persen|%)\b/i;

// ponytail: small hardcoded gazetteer instead of NER/entity linking. Good
// enough to catch an invented area in a work sample; a real system needs
// proper location entity extraction to cover areas outside this list.
const KNOWN_AREA_TERMS = [
  "BSD",
  "Tampines", // used by the SG-voice demo scenarios (ui/src/scenarios.ts)
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

// Drafts mix Indonesian money slang (jt/juta/M/miliar/milyar — the exact
// convention deterministic.ts uses for the lead's own messages) with
// spelled-out English, since agents write bilingually. Extend the shared
// Indonesian unit map with the English equivalents rather than
// re-declaring the jt/juta/M/miliar/milyar convention here.
const WRITER_MONEY_UNIT_MULTIPLIERS: Record<string, number> = {
  ...MONEY_UNIT_MULTIPLIERS,
  million: JUTA_MULTIPLIER,
  billion: MILIAR_MULTIPLIER,
};

const MONEY_UNIT_PATTERN = Object.keys(WRITER_MONEY_UNIT_MULTIPLIERS).join("|");

/**
 * Matches any number in a drafted message, capturing an optional trailing
 * money unit. The number itself may use Indonesian-style separators — see
 * normalizeIndonesianNumber (deterministic.ts) for the thousands-vs-decimal
 * disambiguation rule shared with lead-side extraction.
 */
const NUMBER_TOKEN_REGEX = new RegExp(`(\\d+(?:[.,]\\d+)*)\\s*(${MONEY_UNIT_PATTERN})?\\b`, "gi");

// ponytail: 1% relative tolerance absorbs float drift from multiplying by
// 1e6/1e9 and honest rounding in how an agent phrases the budget back
// ("Rp1,5M" for an exact 1,500,000,000 profile). Tighten if false
// negatives show up in practice.
const MONEY_RELATIVE_TOLERANCE = 0.01;

function isCloseToIDR(value: number, target: number): boolean {
  if (target === 0) return value === 0;
  return Math.abs(value - target) / target < MONEY_RELATIVE_TOLERANCE;
}

function findInventedNumbers(message: string, profile: LeadProfile): string[] {
  const allowed = allowedBudgetNumbers(profile);
  const violations: string[] = [];
  for (const match of message.matchAll(NUMBER_TOKEN_REGEX)) {
    const [full, numberText, unitText] = match;
    const normalized = normalizeIndonesianNumber(numberText);
    if (Number.isNaN(normalized)) continue;

    if (unitText) {
      // Unit is explicit (jt/M/miliar/million/...) — resolve to an actual
      // IDR amount and compare directly against the profile's budget,
      // regardless of how small the written number is ("1,5M" is real
      // money even though 1.5 alone would look incidental).
      const multiplier = WRITER_MONEY_UNIT_MULTIPLIERS[unitText.toLowerCase()];
      const idrValue = normalized * multiplier;
      if (profile.budgetIDR === null || !isCloseToIDR(idrValue, profile.budgetIDR)) {
        violations.push(`number "${full.trim()}" not grounded in the lead profile`);
      }
      continue;
    }

    // No unit: could be a bare IDR figure ("1.500.000.000"), a bare
    // juta/miliar magnitude ("900" meaning 900 million), or an incidental
    // count ("2 units") — fall back to the coarser ratio comparison.
    if (normalized < MIN_FLAGGED_NUMBER) continue;
    // A duration or a count ("a 10-minute call", "15 menit", "3 bedrooms") is not a fact about the lead.
    const after = message.slice((match.index ?? 0) + full.length);
    if (NOT_A_FACT_UNIT.test(after)) continue;
    if (!isCloseToAny(normalized, allowed)) {
      violations.push(`number "${numberText}" not grounded in the lead profile`);
    }
  }
  return violations;
}

function findInventedAreas(message: string, profile: LeadProfile): string[] {
  const lowerMessage = message.toLowerCase();
  const knownAreas = profile.areas.map((a) => a.toLowerCase());
  const violations: string[] = [];
  for (const term of KNOWN_AREA_TERMS) {
    const lowerTerm = term.toLowerCase();
    // "Tampines" in a draft is the lead's area when the lead said "Tampines MRT".
    if (lowerMessage.includes(lowerTerm) && !knownAreas.some((area) => area.includes(lowerTerm))) {
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
