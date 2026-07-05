import type { LlmExtraction, WriterOutput } from "@pipeline/schema";

/**
 * Scripted conversation timelines for the Pipeline Simulator.
 *
 * Every "message" step is real transcript text. Every "llm_extraction" /
 * "llm_draft" step is a RECORDED output — the shape an actual extraction /
 * writer LLM call would return — not something generated live in the
 * browser (see the footer note in App.tsx for why: no network calls here).
 * What DOES run live, in the browser, on this exact recorded data, is the
 * real deterministic pipeline: extractDeterministic, applyGuardrail,
 * classifyLead, qualify, verifyDraft (see src/simulate.ts).
 *
 * Every citation below was checked against these exact message strings by
 * actually running src/guardrail.ts and src/writer-guardrail.ts (see the
 * PR description / report) — not hand-verified by eyeballing substrings.
 */

export type ScenarioStep =
  | { type: "message"; speaker: "lead" | "agent"; text: string; delayMs?: number }
  | { type: "llm_extraction"; extraction: LlmExtraction; note?: string }
  | { type: "llm_draft"; draft: WriterOutput };

export interface Scenario {
  id: string;
  title: string;
  blurb: string;
  leadName: string;
  agentId: string;
  steps: ScenarioStep[];
}

const HAPPY_PATH: Scenario = {
  id: "happy-path",
  title: "Happy path",
  blurb: "Clear budget, area, and urgency — walks all the way to handed off.",
  leadName: "Sarah Lim",
  agentId: "agent_amelia_sg",
  steps: [
    { type: "message", speaker: "lead", text: "hi, saw your listing for the Tampines condo on PropertyGuru, still available?" },
    { type: "message", speaker: "agent", text: "Hi! Yes, it's still available. Would you like more details?" },
    { type: "message", speaker: "lead", text: "yes please. I'm looking to buy, not rent - for own stay" },
    { type: "message", speaker: "agent", text: "Noted! What's your budget range so I can shortlist the right units?" },
    { type: "message", speaker: "lead", text: "budget around 1.5M all-in, including stamp duty" },
    { type: "message", speaker: "agent", text: "Great - any preference within Tampines, nearer the MRT or the park?" },
    { type: "message", speaker: "lead", text: "near Tampines MRT would be ideal" },
    { type: "message", speaker: "agent", text: "Got it. And when are you hoping to move in?" },
    { type: "message", speaker: "lead", text: "quite urgent leh, need to settle by next month" },
    { type: "message", speaker: "agent", text: "That's a quick timeline - let me send you a few suitable units first." },
    {
      type: "llm_extraction",
      note: "Clean extraction — every field is cited from the lead's own words, and the guardrail finds nothing to reject.",
      extraction: {
        budgetIDR: { value: 1_500_000_000, citation: "budget around 1.5M all-in" },
        areas: { value: ["Tampines"], citations: ["near Tampines MRT"] },
        intent: { value: "buy", citation: "I'm looking to buy, not rent" },
        urgency: { value: "high", citation: "quite urgent leh" },
        propertyType: { value: "condo", citation: "Tampines condo" },
        timeline: { value: "next month", citation: "need to settle by next month" },
      },
    },
    {
      type: "llm_draft",
      draft: {
        message:
          "Hi Sarah, I have shortlisted a few Tampines condo units within your 1.5M budget. Since you need to settle by next month, are you free for a viewing this week? Best, Amelia",
        factsUsed: ["budget: 1500000000 IDR", "areas: Tampines", "urgency: high", "timeline: next month"],
      },
    },
  ],
};

const AGENT_FLOATS_BUDGET: Scenario = {
  id: "agent-floats-budget",
  title: "Agent floats a budget",
  blurb: "The agent guesses a number — the lead never confirms it. Watch the guardrail reject it.",
  leadName: "Marcus Tan",
  agentId: "agent_amelia_sg",
  steps: [
    { type: "message", speaker: "lead", text: "hi, is the 2-bedder at District 9 still available?" },
    {
      type: "message",
      speaker: "agent",
      text: "Yes it is! Most buyers asking about this unit have a budget in the 1.5M range - does that match yours?",
    },
    { type: "message", speaker: "lead", text: "hmm not sure yet, let me see the unit first" },
    { type: "message", speaker: "agent", text: "Sure, here are the photos [image]" },
    { type: "message", speaker: "lead", text: "looks decent. this is for sale right, not rental?" },
    { type: "message", speaker: "agent", text: "Yes, it's a resale listing." },
    { type: "message", speaker: "lead", text: "ok let me get back to you on my budget" },
    {
      type: "llm_extraction",
      note: "The lead never stated a budget — the agent did, five turns ago, as a guess (“does that match yours?”), and the lead never confirmed it. A naive extractor reports it anyway. The real guardrail re-checks who actually said it and rejects the citation as agent-sourced.",
      extraction: {
        budgetIDR: { value: 1_500_000_000, citation: "budget in the 1.5M range" },
        areas: { value: ["District 9"], citations: ["District 9"] },
        intent: { value: "buy", citation: "for sale right, not rental" },
        urgency: { value: "unknown", citation: null },
        propertyType: { value: "2-bedder", citation: "2-bedder at District 9" },
        timeline: { value: null, citation: null },
      },
    },
    {
      type: "llm_draft",
      draft: {
        message:
          "Hi Marcus, the 2-bedder in District 9 is still available whenever you want to take a look. Just let me know once you have settled on your budget. Best, Amelia",
        factsUsed: ["areas: District 9", "intent: buy"],
      },
    },
  ],
};

const FRIENDS_BUDGET: Scenario = {
  id: "friends-budget",
  title: "Multi-language: Bahasa Indonesia lead",
  blurb:
    "The same pipeline handles an Indonesian-language lead — including a real quote about the wrong subject (a friend's budget) that the citation check can't catch.",
  leadName: "Teguh Prasetyo",
  agentId: "agent_budi_id",
  steps: [
    {
      type: "message",
      speaker: "lead",
      text: "gan ini beda konteks dikit, temen gue kemarin abis dapet rumah baru di Bintaro",
    },
    { type: "message", speaker: "agent", text: "oh iya kak, kenapa ya?" },
    { type: "message", speaker: "lead", text: "temen gue budgetnya sekitar setengah miliar an, katanya dapet bagus tuh" },
    { type: "message", speaker: "agent", text: "wah lumayan kak, kalau kakak sendiri gimana rencananya?" },
    { type: "message", speaker: "lead", text: "kalo gue sih belom mikir jauh2, msh liat2 aja dulu skrg" },
    { type: "message", speaker: "agent", text: "oke kak santai aja, kabarin kalau udah ada gambaran" },
    { type: "message", speaker: "lead", text: "sip gan nanti gue kabarin" },
    {
      type: "llm_extraction",
      note: "The citation is 100% real and it IS the lead's own words — so the mechanical citation check passes. But it's the lead describing a FRIEND's budget, not their own. Citation verification confirms text is real and correctly sourced, not that it's about the right subject. Catching this needs an attribution-aware prompt, not a stronger guardrail — see README §4. This is exactly why data/conversations.json ships this as an adversarial eval case (c12) instead of a guardrail unit test.",
      extraction: {
        budgetIDR: { value: 500_000_000, citation: "temen gue budgetnya sekitar setengah miliar an" },
        areas: { value: [], citations: [] },
        intent: { value: "unknown", citation: null },
        urgency: { value: "unknown", citation: null },
        propertyType: { value: null, citation: null },
        timeline: { value: null, citation: null },
      },
    },
    { type: "message", speaker: "lead", text: "eh btw gak jadi deh gan, gak minat ah nyari-nyari lagi sekarang" },
    {
      type: "llm_draft",
      draft: {
        message: "Baik Kak, saya stop follow-up untuk saat ini ya, kalau berubah pikiran kabari saya lagi. Salam, Budi",
        factsUsed: [],
      },
    },
  ],
};

export const SCENARIOS: Scenario[] = [HAPPY_PATH, AGENT_FLOATS_BUDGET, FRIENDS_BUDGET];
