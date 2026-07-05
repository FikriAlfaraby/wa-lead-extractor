import { describe, it, expect } from "vitest";
import { JudgeResultSchema } from "../src/judge.js";

describe("JudgeResultSchema", () => {
  it("parses a well-formed judge response", () => {
    const raw = {
      grounded: { score: 5, verdict: "pass" },
      onVoice: { score: 4, verdict: "pass" },
      actionable: { score: 5, verdict: "pass" },
      natural: { score: 3, verdict: "fail" },
    };
    expect(JudgeResultSchema.parse(raw)).toEqual(raw);
  });

  it("is lenient at the boundary: null score/verdict default to the safest (failing) values", () => {
    const raw = {
      grounded: { score: null, verdict: null },
      onVoice: { score: 4, verdict: "pass" },
      actionable: { score: 5, verdict: "pass" },
      natural: { score: 5, verdict: "pass" },
    };
    const parsed = JudgeResultSchema.parse(raw);
    expect(parsed.grounded).toEqual({ score: 1, verdict: "fail" });
  });
});
