import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { loadShown } from "../eval/gloss.js";
import { amounts, isIndonesian, names, problems, shownLines } from "../src/glosses.js";

const file = JSON.parse(readFileSync(new URL("../data/glosses-en.json", import.meta.url), "utf8")) as {
  glosses: Record<string, string | null>;
  corrected_by_hand: Record<string, string>;
};
const glosses = file.glosses;
const shown = loadShown();
const keep = names(shown);
const english = (line: string) => (glosses[line] ?? "").toLowerCase();

describe("the English glosses", () => {
  it("cover every line the page and the simulator show, in order, and nothing else", () => {
    expect(Object.keys(glosses)).toEqual(shownLines(shown));
  });

  it("all pass the checks", () => {
    const failing = Object.entries(glosses).flatMap(([line, gloss]) => {
      const found = problems(line, gloss, keep);
      return found.length ? [`${line.slice(0, 60)}: ${found.join("; ")}`] : [];
    });
    expect(failing).toEqual([]);
  });

  it("exist exactly for the lines with Indonesian in them", () => {
    for (const [line, gloss] of Object.entries(glosses)) expect(gloss === null, line).toBe(!isIndonesian(line));
  });

  it("say what the facts the review rests on say", () => {
    // the answer key's words and the models' answers the review table shows
    expect(english("rumah tinggal")).toMatch(/house to live in/);
    expect(english("rumah")).toMatch(/^house$/);
    expect(english("tahun depan")).toMatch(/next year/);
    expect(english("minggu ini kalo bisa")).toMatch(/this week if possible/);
    expect(english("Belum pasti")).toMatch(/not (decided|sure|certain)/);
    expect(english("tanah kavling")).toMatch(/plot of land/);
    // 1.5M in these chats is 1.5 billion rupiah, which an English reader would misread as a million
    expect(english("budget saya sekitar 1.5M all-in udah termasuk pajak")).toMatch(/1\.5 billion/);
    // the friend's purchase the rule-based stage once read as the lead's own intent
    expect(english("gan ini beda konteks dikit, temen gue kmrn baru beli rumah di Bintaro")).toMatch(/friend .*bought/);
    // "weekend ini bisa" is when the lead can view, not when they will buy
    expect(english("weekend ini bisa, tp ga buru2 juga sih nyarinya, masih compare2")).toMatch(/this weekend.*not in a hurry/);
  });

  it("give every Indonesian draft its budget in billions", () => {
    const drafts = Object.keys(glosses).filter((line) => /miliar/.test(line));
    expect(drafts.length).toBeGreaterThan(0);
    for (const line of drafts) expect(english(line), line).toMatch(/billion/);
  });

  it("edited by hand say why, and still pass", () => {
    for (const [line, why] of Object.entries(file.corrected_by_hand)) {
      expect(why.trim() && line in glosses && problems(line, glosses[line] ?? null, keep).length === 0, line).toBeTruthy();
    }
  });
});

describe("the gloss checks", () => {
  const wrong: [string, string | null, string][] = [
    ["budget saya sekitar 1.5M ya", "My budget is around 1.5 million.", "the number 1500000000 is missing"],
    ["15jt an per bulan kalo bisa", "about 150 million a month if possible", "the gloss adds the number 150000000"],
    ["boleh, ini beli ya bukan sewa", "Sure, this is to buy, to rent.", "the gloss does not"],
    ["masih blm pasti", "still decided", "the gloss does not"],
    ["Sabtu bisa lihat unitnya?", "Can I see the unit on Sunday?", "Saturday is missing"],
    ["permisi, unit apartemen di Kemang yg diposting masih ada?", "Is the posted apartment unit still there?", "Kemang is missing"],
    ["ok nanti saya liat2 dulu", "OK, I'll look2 first.", "a repeated word written with 2"],
    ["halo kak, iya masih ada beberapa unit", null, "the line is Indonesian but has no gloss"],
    ["Hi, saw your listing for a condo in Singapore", "Hi, saw your listing for a condo in Singapore.", "it needs no gloss"],
  ];
  for (const [line, gloss, problem] of wrong) {
    it(`catch: ${problem}`, () => {
      const found = problems(line, gloss, keep);
      expect(found.some((f) => f.includes(problem)), found.join("; ")).toBe(true);
    });
  }

  const right: [string, string | null][] = [
    ["budget saya sekitar 1.5M ya", "My budget is around 1.5 billion."],
    ["Rp 900 juta paling mentok", "Rp 900 million at most"],
    ["gan ada yg dket stasiun ga", "Any places near the station?"],
    ["BSD sama Alam Sutera dua2nya lagi dipertimbangin", "Both BSD and Alam Sutera are being considered."],
    ["Hi Dan, is the unit still available?", null],
  ];
  for (const [line, gloss] of right) {
    it(`pass: ${gloss}`, () => expect(problems(line, gloss, keep)).toEqual([]));
  }

  it("read amounts with their unit", () => {
    expect(amounts("1.5M")).toEqual(["1500000000"]);
    expect(amounts("1,5 miliar or 1.5 billion")).toEqual(["1500000000", "1500000000"]);
    expect(amounts("15jt or 15 million")).toEqual(["15000000", "15000000"]);
    expect(amounts("liat2 dua2nya x2 Rp2.000")).toEqual(["2", "2000"]);
  });
});

describe("the glosses never reach the pipeline", () => {
  it("nothing in src/ besides glosses.ts names them", () => {
    for (const name of readdirSync(new URL("../src/", import.meta.url))) {
      if (name === "glosses.ts") continue;
      expect(readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"), name).not.toMatch(/glosses/);
    }
  });
});
