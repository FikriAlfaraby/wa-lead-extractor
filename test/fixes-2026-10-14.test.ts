import { describe, it, expect } from "vitest";
import { extractDeterministic, parseMoneyToIDR } from "../src/deterministic.js";
import { applyGuardrail } from "../src/guardrail.js";
import { verifyDraft } from "../src/writer-guardrail.js";
import { EMPTY_LEAD_PROFILE } from "../src/schema.js";
import type { AgentProfile, Conversation, LlmExtraction } from "../src/schema.js";
import { valuesMatch } from "../eval/score.js";

/**
 * The five defects found on 14 Oct 2026 by recording real replies and reading every fact the
 * scorer counted wrong (eval/review/2026-10-14.json). Each case is cut from a real chat or reply.
 */

const lead = (text: string) => ({ speaker: "lead" as const, text });
const agent = (text: string) => ({ speaker: "agent" as const, text });

const EMPTY_EXTRACTION: LlmExtraction = {
  budgetIDR: { value: null, citation: null },
  areas: { value: [], citations: [] },
  intent: { value: null, citation: null },
  urgency: { value: null, citation: null },
  propertyType: { value: null, citation: null },
  timeline: { value: null, citation: null },
};

describe("the rule-based stage ignores what the lead says about someone else (c12)", () => {
  it("does not read a friend's purchase as the lead's intent", () => {
    const conversation: Conversation = {
      id: "c12",
      messages: [lead("gan ini beda konteks dikit, temen gue kmrn baru beli rumah di Bintaro")],
    };
    expect(extractDeterministic(conversation).intent).toBeNull();
  });

  it("does not split a number at its decimal point", () => {
    const conversation: Conversation = { id: "x", messages: [lead("budget 1.5M ya, mau beli bulan ini")] };
    expect(extractDeterministic(conversation).budgetIDR).toBe(1_500_000_000);
  });

  it("still reads the lead's own intent in the same message", () => {
    const conversation: Conversation = {
      id: "x",
      messages: [lead("temen gue beli di BSD, gue juga mau beli rumah di situ")],
    };
    const result = extractDeterministic(conversation);
    expect(result.intent).toBe("buy");
    expect(result.intentCitation).toBe("mau beli");
  });
});

describe("one quote can name two areas (Luna, c07)", () => {
  const conversation: Conversation = {
    id: "c07",
    messages: [agent("boleh kak, ada beberapa opsi area yg diliat?"), lead("BSD sama Alam Sutera dua2nya lagi dipertimbangin")],
  };

  it("keeps an area that the lead's quote for another area also names", () => {
    const extraction = { ...EMPTY_EXTRACTION, areas: { value: ["BSD", "Alam Sutera"], citations: ["BSD sama Alam Sutera dua2nya lagi dipertimbangin"] } };
    const result = applyGuardrail(extraction, conversation);
    expect(result.profile.areas).toEqual(["BSD", "Alam Sutera"]);
    expect(result.violations).toEqual([]);
  });

  it("still throws out an area no quote names", () => {
    const extraction = { ...EMPTY_EXTRACTION, areas: { value: ["BSD", "Kemang"], citations: ["BSD sama Alam Sutera dua2nya lagi dipertimbangin"] } };
    const result = applyGuardrail(extraction, conversation);
    expect(result.profile.areas).toEqual(["BSD"]);
    expect(result.violations).toEqual([{ field: "areas[1]", reason: "missing_citation", citation: null }]);
  });
});

describe("money is read by the chat's market (the Singapore scenario)", () => {
  it("does not read a Singapore '1.5M' as rupiah", () => {
    expect(parseMoneyToIDR("budget around 1.5M all-in, including stamp duty", "sg")).toBeNull();
  });

  it("still reads rupiah the lead names in a Singapore chat (c03)", () => {
    expect(parseMoneyToIDR("kalo dirupiahkan kira2 2 miliar lah", "sg")?.amount).toBe(2_000_000_000);
  });

  it("reads '1.5M' as 1.5 billion rupiah in an Indonesian chat, as before", () => {
    expect(parseMoneyToIDR("budget 1.5M all in kak")?.amount).toBe(1_500_000_000);
    expect(parseMoneyToIDR("budget 1.5M all in kak", "id")?.amount).toBe(1_500_000_000);
  });

  it("passes the market through the rule-based stage", () => {
    const conversation: Conversation = { id: "sg", market: "sg", messages: [lead("budget around 1.5M all-in, including stamp duty")] };
    expect(extractDeterministic(conversation).budgetIDR).toBeNull();
  });
});

describe("the draft check stops flagging the harmless (Gemini, Luna)", () => {
  const amelia: AgentProfile = {
    id: "agent_amelia_sg",
    name: "Amelia",
    voice: { tone: "warm-professional", language: "en-sg", signOff: "Best, Amelia", emojiPolicy: "sparing", maxSentences: 4 },
  };

  it("a '10-minute call' is not a number about the lead", () => {
    const draft = { message: "Hi, could we schedule a quick 10-minute call tomorrow to run through your preferences? Best, Amelia", factsUsed: [] };
    expect(verifyDraft(draft, { ...EMPTY_LEAD_PROFILE, areas: ["District 9"] }, amelia)).toEqual({ passed: true, violations: [] });
  });

  it("'Tampines' inside the lead's 'Tampines MRT' is the lead's area", () => {
    const draft = { message: "Hi! Shall I shortlist condos near Tampines MRT for you? Best, Amelia", factsUsed: [] };
    expect(verifyDraft(draft, { ...EMPTY_LEAD_PROFILE, areas: ["Tampines MRT"] }, amelia)).toEqual({ passed: true, violations: [] });
  });

  it("still flags a price nobody gave", () => {
    const draft = { message: "Units start at 1.2 billion IDR. Best, Amelia", factsUsed: [] };
    expect(verifyDraft(draft, { ...EMPTY_LEAD_PROFILE, areas: ["Tampines MRT"] }, amelia).passed).toBe(false);
  });
});

describe("the scorer's word rule (eval/score.ts)", () => {
  it("matches the same fact in fewer or more words", () => {
    expect(valuesMatch("propertyType", "rumah tinggal", "rumah")).toBe(true);
    expect(valuesMatch("propertyType", "2BR", "apartemen 2BR")).toBe(true);
    expect(valuesMatch("timeline", "minggu ini kalo bisa", "minggu ini")).toBe(true);
    expect(valuesMatch("areas", ["BSD", "BSD City"], ["BSD"])).toBe(true);
  });

  it("does not match a translation, an extra place, or a different value", () => {
    expect(valuesMatch("propertyType", "studio apartment", "apartemen studio")).toBe(false);
    expect(valuesMatch("timeline", "next year", "tahun depan")).toBe(false);
    expect(valuesMatch("areas", ["BSD", "deket De Park"], ["BSD"])).toBe(false);
    expect(valuesMatch("timeline", "weekend ini", null)).toBe(false);
    expect(valuesMatch("intent", "buy", "rent")).toBe(false);
  });
});
