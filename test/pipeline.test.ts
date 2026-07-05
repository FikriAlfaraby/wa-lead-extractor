import { describe, it, expect } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import type { Conversation, LlmExtraction } from "../src/schema.js";
import type { ExtractFn } from "../src/extract.js";

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

function mockExtractFn(extraction: LlmExtraction): ExtractFn {
  return async () => extraction;
}

describe("runPipeline", () => {
  it("deterministic wins over a conflicting LLM value for budget/intent/urgency", async () => {
    const conversation: Conversation = {
      id: "p1",
      messages: [
        { speaker: "lead", text: "saya mau beli ya, budget 900jt, bulan ini kalo bisa" },
      ],
    };

    // LLM (mocked) disagrees with the deterministic stage on every
    // overlapping field. Deterministic must win.
    const extraction = baseExtraction({
      budgetIDR: { value: 1_200_000_000, citation: "budget 900jt" },
      intent: { value: "rent", citation: "saya mau beli ya" },
      urgency: { value: "low", citation: "bulan ini kalo bisa" },
      propertyType: { value: "apartemen", citation: "budget 900jt" },
    });

    const { profile } = await runPipeline(conversation, mockExtractFn(extraction));

    expect(profile.budgetIDR).toBe(900_000_000); // deterministic value, not 1.2B
    expect(profile.intent).toBe("buy"); // deterministic value, not "rent"
    expect(profile.urgency).toBe("high"); // deterministic value, not "low"
    expect(profile.propertyType).toBe("apartemen"); // LLM-only field passes through
  });

  it("falls back to the guardrail-verified LLM value when deterministic finds nothing", async () => {
    const conversation: Conversation = {
      id: "p2",
      messages: [
        { speaker: "lead", text: "nyari properti di Kemang, condo kalo ada" },
      ],
    };

    const extraction = baseExtraction({
      areas: { value: ["Kemang"], citations: ["Kemang"] },
      propertyType: { value: "condo", citation: "condo kalo ada" },
    });

    const { profile } = await runPipeline(conversation, mockExtractFn(extraction));

    expect(profile.areas).toEqual(["Kemang"]);
    expect(profile.propertyType).toBe("condo");
    expect(profile.budgetIDR).toBeNull();
    expect(profile.intent).toBe("unknown");
  });

  it("yields an entirely null/empty/unknown profile for a sparse conversation", async () => {
    const conversation: Conversation = {
      id: "p3",
      messages: [
        { speaker: "lead", text: "halo min" },
        { speaker: "agent", text: "halo kak ada yg bisa dibantu?" },
        { speaker: "lead", text: "mau tanya2 dulu aja" },
      ],
    };

    const extraction = baseExtraction();
    const { profile, violations } = await runPipeline(conversation, mockExtractFn(extraction));

    expect(profile).toEqual({
      budgetIDR: null,
      areas: [],
      intent: "unknown",
      urgency: "unknown",
      propertyType: null,
      timeline: null,
    });
    expect(violations).toHaveLength(0);
  });

  it("propagates guardrail violations when the mocked LLM fabricates a citation", async () => {
    const conversation: Conversation = {
      id: "p4",
      messages: [{ speaker: "lead", text: "masih liat-liat aja dulu" }],
    };

    const extraction = baseExtraction({
      budgetIDR: { value: 500_000_000, citation: "budget saya 500 juta" },
    });

    const { profile, violations } = await runPipeline(conversation, mockExtractFn(extraction));

    expect(profile.budgetIDR).toBeNull();
    expect(violations).toEqual([
      { field: "budgetIDR", reason: "citation_not_found", citation: "budget saya 500 juta" },
    ]);
  });
});
