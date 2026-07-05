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

const JUTA_MULTIPLIER = 1_000_000;
const MILIAR_MULTIPLIER = 1_000_000_000;

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

export function parseMoneyToIDR(
  text: string
): { amount: number; matchedText: string } | null {
  const match = text.match(MONEY_REGEX);
  if (!match) return null;

  const numberPart = match[1].replace(",", ".");
  const unit = match[2].toLowerCase();
  const base = parseFloat(numberPart);
  if (Number.isNaN(base)) return null;

  const multiplier =
    unit === "jt" || unit === "juta" ? JUTA_MULTIPLIER : MILIAR_MULTIPLIER;

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

    if (result.budgetIDR === null) {
      const money = parseMoneyToIDR(message.text);
      if (money) {
        result.budgetIDR = money.amount;
        result.budgetCitation = money.matchedText;
      }
    }

    if (result.intent === null) {
      const buyHit = findKeyword(message.text, BUY_KEYWORDS);
      if (buyHit) {
        result.intent = "buy";
        result.intentCitation = buyHit;
      } else {
        const rentHit = findKeyword(message.text, RENT_KEYWORDS);
        if (rentHit) {
          result.intent = "rent";
          result.intentCitation = rentHit;
        }
      }
    }

    if (result.urgency === null) {
      const highHit = findKeyword(message.text, HIGH_URGENCY_KEYWORDS);
      if (highHit) {
        result.urgency = "high";
        result.urgencyCitation = highHit;
      } else {
        const lowHit = findKeyword(message.text, LOW_URGENCY_KEYWORDS);
        if (lowHit) {
          result.urgency = "low";
          result.urgencyCitation = lowHit;
        }
      }
    }
  }

  return result;
}
