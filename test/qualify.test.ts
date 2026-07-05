import { describe, it, expect } from "vitest";
import { qualify, detectExplicitStop } from "../src/qualify.js";
import { EMPTY_LEAD_PROFILE } from "../src/schema.js";
import type { LeadProfile, Conversation } from "../src/schema.js";

const NO_STOP = { explicitStop: false };
const STOP = { explicitStop: true };

function profile(overrides: Partial<LeadProfile> = {}): LeadProfile {
  return { ...EMPTY_LEAD_PROFILE, ...overrides };
}

describe("qualify", () => {
  it("stays new when the profile has no facts yet", () => {
    const result = qualify("new", profile(), NO_STOP);
    expect(result).toEqual({ state: "new", reason: "no lead facts extracted yet" });
  });

  it("moves new -> qualifying once some facts are collected but the bar isn't met", () => {
    const result = qualify("new", profile({ areas: ["BSD"] }), NO_STOP);
    expect(result.state).toBe("qualifying");
  });

  it("moves qualifying -> qualified once budget, intent, and area are all present", () => {
    const result = qualify(
      "qualifying",
      profile({ budgetIDR: 900_000_000, intent: "buy", areas: ["BSD"] }),
      NO_STOP
    );
    expect(result.state).toBe("qualified");
  });

  it("moves qualifying -> handed_off when qualified AND urgency is high", () => {
    const result = qualify(
      "qualifying",
      profile({ budgetIDR: 900_000_000, intent: "buy", areas: ["BSD"], urgency: "high" }),
      NO_STOP
    );
    expect(result.state).toBe("handed_off");
    expect(result.reason).toMatch(/handed off/);
  });

  it("stays qualifying when the bar isn't met yet (missing area)", () => {
    const result = qualify(
      "qualifying",
      profile({ budgetIDR: 900_000_000, intent: "buy" }),
      NO_STOP
    );
    expect(result.state).toBe("qualifying");
  });

  it("disqualifies on an explicit stop signal regardless of profile completeness", () => {
    const result = qualify(
      "qualifying",
      profile({ budgetIDR: 900_000_000, intent: "buy", areas: ["BSD"] }),
      STOP
    );
    expect(result.state).toBe("disqualified");
    expect(result.reason).toMatch(/stop/);
  });

  it("disqualifies when budget is far below the listing floor", () => {
    const result = qualify("qualifying", profile({ budgetIDR: 10_000_000 }), NO_STOP);
    expect(result.state).toBe("disqualified");
    expect(result.reason).toMatch(/listing floor/);
  });

  it("does not disqualify on a budget only moderately below the floor", () => {
    const result = qualify("qualifying", profile({ budgetIDR: 80_000_000 }), NO_STOP);
    expect(result.state).not.toBe("disqualified");
  });

  it("keeps disqualified as a terminal, no-op state", () => {
    const result = qualify(
      "disqualified",
      profile({ budgetIDR: 900_000_000, intent: "buy", areas: ["BSD"] }),
      NO_STOP
    );
    expect(result).toEqual({
      state: "disqualified",
      reason: 'already in terminal state "disqualified"',
    });
  });

  it("keeps handed_off as a terminal, no-op state", () => {
    const result = qualify("handed_off", profile(), STOP);
    expect(result.state).toBe("handed_off");
  });

  it("can go straight from new to qualified when the profile already meets the bar", () => {
    const result = qualify(
      "new",
      profile({ budgetIDR: 900_000_000, intent: "buy", areas: ["BSD"] }),
      NO_STOP
    );
    expect(result.state).toBe("qualified");
  });
});

describe("detectExplicitStop", () => {
  it("detects a stop keyword in a lead message", () => {
    const conversation: Conversation = {
      id: "q1",
      messages: [{ speaker: "lead", text: "makasih gan, tidak tertarik lagi" }],
    };
    expect(detectExplicitStop(conversation)).toBe(true);
  });

  it("ignores a stop keyword said by the agent", () => {
    const conversation: Conversation = {
      id: "q2",
      messages: [{ speaker: "agent", text: "boleh kirim stop kalau tidak tertarik" }],
    };
    expect(detectExplicitStop(conversation)).toBe(false);
  });

  it("returns false when no stop keyword is present", () => {
    const conversation: Conversation = {
      id: "q3",
      messages: [{ speaker: "lead", text: "masih minat, tunggu kabar ya" }],
    };
    expect(detectExplicitStop(conversation)).toBe(false);
  });
});
