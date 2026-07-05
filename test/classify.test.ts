import { describe, it, expect } from "vitest";
import { classifyLead } from "../src/classify.js";
import type { Conversation } from "../src/schema.js";

function conversationWithLeadMessages(count: number): Conversation {
  return {
    id: "cl1",
    messages: Array.from({ length: count }, (_, i) => ({
      speaker: "lead" as const,
      text: `message ${i}`,
    })),
  };
}

const NOW = "2026-07-06T00:00:00.000Z";

describe("classifyLead", () => {
  it("classifies a brand-new lead (few messages, <48h old) as new", () => {
    const state = classifyLead({
      conversation: conversationWithLeadMessages(1),
      lastLeadMessageAt: "2026-07-05T12:00:00.000Z",
      firstContactAt: "2026-07-05T12:00:00.000Z",
      now: NOW,
    });
    expect(state).toBe("new");
  });

  it("classifies a lead that replied within 7 days as warm", () => {
    const state = classifyLead({
      conversation: conversationWithLeadMessages(10),
      lastLeadMessageAt: "2026-07-02T00:00:00.000Z", // 4 days ago
      firstContactAt: "2026-05-01T00:00:00.000Z", // long-standing lead
      now: NOW,
    });
    expect(state).toBe("warm");
  });

  it("classifies a lead silent for more than 14 days as cold", () => {
    const state = classifyLead({
      conversation: conversationWithLeadMessages(10),
      lastLeadMessageAt: "2026-06-15T00:00:00.000Z", // 21 days ago
      firstContactAt: "2026-05-01T00:00:00.000Z",
      now: NOW,
    });
    expect(state).toBe("cold");
  });

  it("does not classify as new once message count and age both exceed the thresholds", () => {
    const state = classifyLead({
      conversation: conversationWithLeadMessages(10),
      lastLeadMessageAt: "2026-07-06T00:00:00.000Z", // just replied
      firstContactAt: "2026-05-01T00:00:00.000Z", // old lead
      now: NOW,
    });
    expect(state).toBe("warm");
  });

  it("prioritizes new over warm when both technically apply", () => {
    const state = classifyLead({
      conversation: conversationWithLeadMessages(1),
      lastLeadMessageAt: "2026-07-05T12:00:00.000Z", // within 7 days too
      firstContactAt: "2026-07-05T12:00:00.000Z", // 12h old
      now: NOW,
    });
    expect(state).toBe("new");
  });

  it("defaults the 7-14 day gap to cold", () => {
    const state = classifyLead({
      conversation: conversationWithLeadMessages(10),
      lastLeadMessageAt: "2026-06-26T00:00:00.000Z", // 10 days ago
      firstContactAt: "2026-05-01T00:00:00.000Z",
      now: NOW,
    });
    expect(state).toBe("cold");
  });

  it("treats exactly 7 days since last reply as still warm (inclusive boundary)", () => {
    const state = classifyLead({
      conversation: conversationWithLeadMessages(10),
      lastLeadMessageAt: "2026-06-29T00:00:00.000Z", // exactly 7 days ago
      firstContactAt: "2026-05-01T00:00:00.000Z",
      now: NOW,
    });
    expect(state).toBe("warm");
  });
});
