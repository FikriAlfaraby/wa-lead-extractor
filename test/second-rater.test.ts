import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agreement, cohenKappa, OUT } from "../eval/second-rater/agreement.js";
import { judgmentItems } from "../eval/second-rater/items.js";

describe("second rater", () => {
  it("rates exactly the facts my review judged: the 20 the scorer still counts invented", () => {
    const review = JSON.parse(readFileSync("eval/review/2026-10-14.json", "utf8")) as {
      facts: { model: string; conversation: string; field: string; category: string }[];
    };
    const judged = review.facts
      .filter((f) => ["right", "debatable", "wrong"].includes(f.category))
      .map((f) => `${f.model} ${f.conversation} ${f.field}`)
      .sort();
    const items = judgmentItems().map((i) => `${i.model} ${i.conversation} ${i.field}`).sort();
    expect(items).toHaveLength(20);
    expect(items).toEqual(judged);
  });

  it("computes Cohen's kappa as observed agreement corrected for chance", () => {
    // observed 3/4; chance 0.5 x 0.25 + 0.5 x 0.75 = 0.5; kappa = (0.75 - 0.5) / (1 - 0.5)
    expect(cohenKappa(["right", "right", "wrong", "wrong"], ["right", "wrong", "wrong", "wrong"])).toBeCloseTo(0.5);
    expect(cohenKappa(["right", "wrong"], ["right", "wrong"])).toBe(1);
  });

  it("keeps the published agreement file equal to what the labels give today", () => {
    expect(JSON.parse(readFileSync(OUT, "utf8"))).toEqual(agreement());
  });

  it("states the published numbers in the README", () => {
    const readme = readFileSync("README.md", "utf8").replace(/\s+/g, " ");
    const result = agreement();
    expect(readme).toContain(`agreed with mine on ${result.agree} of ${result.items}`);
    expect(readme).toContain(`Cohen's kappa ${result.kappa.toFixed(2)}`);
  });
});
