import { describe, it, expect } from "vitest";
import { applyGuardrail } from "../src/guardrail.js";
import type { Conversation, LlmExtraction } from "../src/schema.js";

function baseExtraction(overrides: Partial<LlmExtraction> = {}): LlmExtraction {
  return {
    budgetIDR: { value: null, citation: null },
    areas: { value: [], citations: [] },
    intent: { value: null, citation: null },
    urgency: { value: null, citation: null },
    propertyType: { value: null, citation: null },
    timeline: { value: null, citation: null },
    ...overrides,
  };
}

describe("applyGuardrail", () => {
  it("accepts a value with a valid verbatim citation from the lead", () => {
    const conversation: Conversation = {
      id: "g1",
      messages: [{ speaker: "lead", text: "budget saya sekitar 900 juta ya" }],
    };
    const extraction = baseExtraction({
      budgetIDR: { value: 900_000_000, citation: "900 juta" },
    });

    const { profile, violations } = applyGuardrail(extraction, conversation);
    expect(profile.budgetIDR).toBe(900_000_000);
    expect(violations).toHaveLength(0);
  });

  it("nulls a fabricated citation that does not appear anywhere in the transcript", () => {
    const conversation: Conversation = {
      id: "g2",
      messages: [{ speaker: "lead", text: "saya cuma mau liat-liat dulu" }],
    };
    const extraction = baseExtraction({
      budgetIDR: { value: 500_000_000, citation: "budget saya 500 juta" },
    });

    const { profile, violations } = applyGuardrail(extraction, conversation);
    expect(profile.budgetIDR).toBeNull();
    expect(violations).toEqual([
      { field: "budgetIDR", reason: "citation_not_found", citation: "budget saya 500 juta" },
    ]);
  });

  it("nulls a citation that is real text but came from the AGENT, not the lead (agent-voice trap)", () => {
    const conversation: Conversation = {
      id: "g3",
      messages: [
        { speaker: "agent", text: "biasanya budget di kisaran 1.5M ya kak" },
        { speaker: "lead", text: "hmm blm tau juga sih" },
      ],
    };
    const extraction = baseExtraction({
      budgetIDR: { value: 1_500_000_000, citation: "budget di kisaran 1.5M" },
    });

    const { profile, violations } = applyGuardrail(extraction, conversation);
    expect(profile.budgetIDR).toBeNull();
    expect(violations).toEqual([
      {
        field: "budgetIDR",
        reason: "citation_from_agent",
        citation: "budget di kisaran 1.5M",
      },
    ]);
  });

  it("nulls a field with a value but a missing citation", () => {
    const conversation: Conversation = {
      id: "g4",
      messages: [{ speaker: "lead", text: "mau beli apartemen di Kemang" }],
    };
    const extraction = baseExtraction({
      propertyType: { value: "apartemen", citation: null },
    });

    const { profile, violations } = applyGuardrail(extraction, conversation);
    expect(profile.propertyType).toBeNull();
    expect(violations).toEqual([
      { field: "propertyType", reason: "missing_citation", citation: null },
    ]);
  });

  it("verifies citations case-insensitively and across whitespace differences", () => {
    const conversation: Conversation = {
      id: "g5",
      messages: [{ speaker: "lead", text: "Area   Kemang   aja ya deket kantor" }],
    };
    const extraction = baseExtraction({
      areas: { value: ["Kemang"], citations: ["area kemang aja"] },
    });

    const { profile, violations } = applyGuardrail(extraction, conversation);
    expect(profile.areas).toEqual(["Kemang"]);
    expect(violations).toHaveLength(0);
  });

  it("partially verifies an array field: valid entries survive, fabricated ones are dropped", () => {
    const conversation: Conversation = {
      id: "g6",
      messages: [{ speaker: "lead", text: "BSD sama Alam Sutera dua duanya lagi dipertimbangkan" }],
    };
    const extraction = baseExtraction({
      areas: {
        value: ["BSD", "Singapore"],
        citations: ["BSD", "Singapore mentioned"],
      },
    });

    const { profile, violations } = applyGuardrail(extraction, conversation);
    expect(profile.areas).toEqual(["BSD"]);
    expect(violations).toEqual([
      { field: "areas[1]", reason: "citation_not_found", citation: "Singapore mentioned" },
    ]);
  });

  it("treats 'unknown' intent/urgency as no-op even without citation", () => {
    const conversation: Conversation = {
      id: "g7",
      messages: [{ speaker: "lead", text: "halo" }],
    };
    const extraction = baseExtraction({
      intent: { value: "unknown", citation: null },
      urgency: { value: "unknown", citation: null },
    });

    const { profile, violations } = applyGuardrail(extraction, conversation);
    expect(profile.intent).toBe("unknown");
    expect(profile.urgency).toBe("unknown");
    expect(violations).toHaveLength(0);
  });
});
