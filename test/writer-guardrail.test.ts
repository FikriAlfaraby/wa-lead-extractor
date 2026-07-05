import { describe, it, expect } from "vitest";
import { verifyDraft } from "../src/writer-guardrail.js";
import { EMPTY_LEAD_PROFILE } from "../src/schema.js";
import type { AgentProfile, LeadProfile } from "../src/schema.js";
import type { WriterOutput } from "../src/writer.js";

const AGENT: AgentProfile = {
  id: "agent_test",
  name: "Test Agent",
  voice: {
    tone: "warm-professional",
    language: "en-sg",
    signOff: "Best, Test",
    emojiPolicy: "sparing",
    maxSentences: 3,
  },
};

const PROFILE: LeadProfile = {
  ...EMPTY_LEAD_PROFILE,
  budgetIDR: 900_000_000,
  areas: ["BSD"],
  intent: "buy",
};

describe("verifyDraft", () => {
  it("passes a clean draft that only references facts in the profile", () => {
    const draft: WriterOutput = {
      message:
        "Hi! Following up on the BSD home you were looking at around 900 million. Keen to book a viewing this week?",
      factsUsed: ["areas: BSD", "budget: 900000000 IDR"],
    };
    const verdict = verifyDraft(draft, PROFILE, AGENT);
    expect(verdict).toEqual({ passed: true, violations: [] });
  });

  it("rejects a draft that invents a price not in the profile", () => {
    const draft: WriterOutput = {
      message: "Hi! We now have a unit for 1200 million, want to take a look?",
      factsUsed: [],
    };
    const verdict = verifyDraft(draft, PROFILE, AGENT);
    expect(verdict.passed).toBe(false);
    expect(verdict.violations.some((v) => v.includes("not grounded"))).toBe(true);
  });

  it("rejects a draft that invents an area not in the profile", () => {
    const draft: WriterOutput = {
      message: "Hi! Found a great unit in Kemang for you, want to take a look?",
      factsUsed: [],
    };
    const verdict = verifyDraft(draft, PROFILE, AGENT);
    expect(verdict.passed).toBe(false);
    expect(verdict.violations.some((v) => v.includes("Kemang"))).toBe(true);
  });

  it("rejects a draft that exceeds the agent's max sentence count", () => {
    const draft: WriterOutput = {
      message: "Hi there. Still thinking about BSD? We have new units. Want to see them? Let me know soon.",
      factsUsed: ["areas: BSD"],
    };
    const verdict = verifyDraft(draft, PROFILE, AGENT);
    expect(verdict.passed).toBe(false);
    expect(verdict.violations.some((v) => v.includes("sentences"))).toBe(true);
  });

  it("rejects a draft with more emoji than the agent's policy allows", () => {
    const draft: WriterOutput = {
      message: "Hi! 😊 Still interested in BSD? 🏡 Let's chat!",
      factsUsed: ["areas: BSD"],
    };
    const verdict = verifyDraft(draft, PROFILE, AGENT);
    expect(verdict.passed).toBe(false);
    expect(verdict.violations.some((v) => v.includes("emoji"))).toBe(true);
  });

  it("does not flag small incidental numbers like a day count or unit count", () => {
    const draft: WriterOutput = {
      message: "Hi! We have 2 units left in BSD, free for a viewing this week?",
      factsUsed: ["areas: BSD"],
    };
    const verdict = verifyDraft(draft, PROFILE, AGENT);
    expect(verdict.passed).toBe(true);
  });
});
