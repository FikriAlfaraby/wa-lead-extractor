import type { Conversation, Intent, Urgency } from "./schema.js";

/**
 * Stage 1: deterministic, regex/rule-based extraction.
 *
 * This stage only handles patterns regex is *actually reliable* at:
 * explicit money amounts, explicit intent keywords, explicit urgency
 * keywords. It runs before the LLM stage and — per the merge policy in
 * pipeline.ts — wins on conflict, because it is cheap, 100% auditable
 * (you can point at the exact regex that fired), and cannot hallucinate.
 *
 * It intentionally does NOT try to extract areas or property type: those
 * require open-vocabulary matching (any neighborhood name, any property
 * type) that a small fixed rule set cannot cover without constant
 * maintenance, so that work is left to the LLM stage.
 */

export interface DeterministicResult {
  budgetIDR: number | null;
  budgetCitation: string | null;
  intent: Intent | null;
  intentCitation: string | null;
  urgency: Urgency | null;
  urgencyCitation: string | null;
}

export const JUTA_MULTIPLIER = 1_000_000;
export const MILIAR_MULTIPLIER = 1_000_000_000;

/**
 * Shared jt/juta/M/miliar/milyar convention, exported so any other module
 * that needs to resolve a money UNIT to a multiplier (e.g. the writer
 * guardrail's grounding check) uses the exact same mapping instead of
 * re-declaring it.
 */
export const MONEY_UNIT_MULTIPLIERS: Record<string, number> = {
  jt: JUTA_MULTIPLIER,
  juta: JUTA_MULTIPLIER,
  m: MILIAR_MULTIPLIER,
  miliar: MILIAR_MULTIPLIER,
  milyar: MILIAR_MULTIPLIER,
};

/**
 * Resolves the thousands-vs-decimal ambiguity in Indonesian-formatted
 * numbers, where BOTH "." and "," can be either separator depending on
 * context (unlike English, which fixes "," = thousands, "." = decimal).
 *
 * Rule: look at the LAST separator in the string.
 *   - exactly 3 digits after it -> thousands separator
 *     ("1.500.000.000" -> 1500000000, "1.500" alone -> 1500)
 *   - 1 or 2 digits after it    -> decimal separator
 *     ("1,5" -> 1.5, "2.3" -> 2.3)
 * Any earlier separators are always thousands groupings and are stripped.
 */
export function normalizeIndonesianNumber(raw: string): number {
  const trimmed = raw.trim();
  const lastSepIndex = Math.max(trimmed.lastIndexOf("."), trimmed.lastIndexOf(","));
  if (lastSepIndex === -1) return parseFloat(trimmed);

  const digitsAfter = trimmed.length - lastSepIndex - 1;
  const integerPart = trimmed.slice(0, lastSepIndex).replace(/[.,]/g, "");
  const fractionPart = trimmed.slice(lastSepIndex + 1);

  if (digitsAfter === 3) return parseFloat(integerPart + fractionPart);
  return parseFloat(`${integerPart}.${fractionPart}`);
}

/**
 * Matches Indonesian WA-slang money amounts said BY THE LEAD, e.g.:
 *   "800jt", "800 jt", "800juta", "Rp 900 juta", "2 miliar", "2M", "1.5M"
 * Convention (matches common Indonesian property-chat usage):
 *   - "jt" / "juta"            -> multiply by 1,000,000
 *   - "M" / "miliar" / "milyar" -> multiply by 1,000,000,000
 * "M" is treated as miliar (billion), not million, because that is the
 * dominant convention in Indonesian real-estate WA chats for budgets in
 * the hundreds-of-millions-to-billions range.
 */
const MONEY_REGEX =
  /(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(jt|juta|m|miliar|milyar)\b/i;
/** Outside Indonesia "M" means million in the local currency; only rupiah said as rupiah counts. */
const RUPIAH_ONLY_REGEX =
  /(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(jt|juta|miliar|milyar)\b|rp\.?\s*(\d+(?:[.,]\d+)?)\s*(m)\b/i;

export type Market = "id" | "sg";

export function parseMoneyToIDR(
  text: string,
  market: Market = "id"
): { amount: number; matchedText: string } | null {
  const found = text.match(market === "id" ? MONEY_REGEX : RUPIAH_ONLY_REGEX);
  if (!found) return null;
  // Normalise the rupiah-only pattern's second alternative into the same two groups.
  const match = found[1] === undefined ? [found[0], found[3], found[4]] : found;

  const base = normalizeIndonesianNumber(match[1]);
  const unit = match[2].toLowerCase();
  if (Number.isNaN(base)) return null;

  const multiplier = MONEY_UNIT_MULTIPLIERS[unit];

  return {
    amount: Math.round(base * multiplier),
    matchedText: match[0],
  };
}

const BUY_KEYWORDS = [
  "mau beli",
  "mau ambil",
  "cari beli",
  "looking to buy",
  "want to buy",
  "beli rumah",
  "beli unit",
  "beli apartemen",
];

const RENT_KEYWORDS = [
  "cari sewa",
  "mau sewa",
  "looking to rent",
  "want to rent",
  "sewa rumah",
  "sewa apartemen",
  "kontrak rumah",
  "for rent",
];

const HIGH_URGENCY_KEYWORDS = [
  "asap",
  "urgent",
  "bulan ini",
  "minggu ini",
  "secepatnya",
  "buru-buru",
];

const LOW_URGENCY_KEYWORDS = [
  "tahun depan",
  "belum buru-buru",
  "santai aja",
  "no rush",
  "just looking",
  "masih survey",
];

/** Words that put a clause about someone other than the lead: "temen gue", "my sister". */
const THIRD_PARTY =
  /\b(temen|teman|sepupu|tetangga|saudara|bokap|nyokap|ortu|orang ?tua|kakak (?:gue|gw|saya|aku)|adik (?:gue|gw|saya|aku)|my (?:friend|friends|brother|sister|parents|cousin|neighbou?r|colleague)|a friend)\b/i;
/** Clause boundaries inside one message; a point or comma inside a number ("1.5M") is not one. */
const CLAUSE_BREAK = /(?<!\d)[.,]|[.,](?!\d)|[;!?]|\b(?:tapi|terus|trus|but|and then)\b/i;

function findKeyword(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  for (const keyword of keywords) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

/**
 * Runs deterministic extraction over the LEAD's messages only. Agent
 * messages are ignored at this stage too, for the same reason the
 * guardrail rejects agent citations: only the lead's own words establish
 * a lead fact.
 */
export function extractDeterministic(
  conversation: Conversation
): DeterministicResult {
  const result: DeterministicResult = {
    budgetIDR: null,
    budgetCitation: null,
    intent: null,
    intentCitation: null,
    urgency: null,
    urgencyCitation: null,
  };

  for (const message of conversation.messages) {
    if (message.speaker !== "lead") continue;
    // What the lead says about a friend or a relative is not about the lead: drop those clauses.
    const ownWords = message.text
      .split(CLAUSE_BREAK)
      .filter((clause) => clause && !THIRD_PARTY.test(clause))
      .join(" ");

    if (result.budgetIDR === null) {
      const money = parseMoneyToIDR(ownWords, conversation.market ?? "id");
      if (money) {
        result.budgetIDR = money.amount;
        result.budgetCitation = money.matchedText;
      }
    }

    if (result.intent === null) {
      const buyHit = findKeyword(ownWords, BUY_KEYWORDS);
      if (buyHit) {
        result.intent = "buy";
        result.intentCitation = buyHit;
      } else {
        const rentHit = findKeyword(ownWords, RENT_KEYWORDS);
        if (rentHit) {
          result.intent = "rent";
          result.intentCitation = rentHit;
        }
      }
    }

    if (result.urgency === null) {
      const highHit = findKeyword(ownWords, HIGH_URGENCY_KEYWORDS);
      if (highHit) {
        result.urgency = "high";
        result.urgencyCitation = highHit;
      } else {
        const lowHit = findKeyword(ownWords, LOW_URGENCY_KEYWORDS);
        if (lowHit) {
          result.urgency = "low";
          result.urgencyCitation = lowHit;
        }
      }
    }
  }

  return result;
}
