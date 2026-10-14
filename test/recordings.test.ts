import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { evalItems, loadRecording, resultPath } from "../eval/recording.js";
import { FIELDS, scoreRun } from "../eval/score.js";
import { applyGuardrail } from "../src/guardrail.js";
import { outputsFor, runSimulation, sourcesFor } from "../src/replay.js";
import { HAND_MADE, ScenarioSchema, type Scenario } from "../src/scenario.js";
import { AgentProfileSchema, type AgentProfile } from "../src/schema.js";

/**
 * The recordings are the evidence behind every number and every model
 * output the site shows. These tests keep the published files and the
 * scenario notes honest: re-scoring a recording must give the published
 * results, the hand review must cover exactly the facts the scorer marks
 * wrong, and each claim a scenario note makes must hold in the recording.
 */

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf-8");
const json = (path: string): unknown => JSON.parse(read(path));

const scenarios = (json("data/scenarios.json") as unknown[]).map((s) => ScenarioSchema.parse(s));
const agents = (json("data/agents.json") as unknown[]).map((a) => AgentProfileSchema.parse(a));
const agentOf = (s: Scenario): AgentProfile => agents.find((a) => a.id === s.agentId) as AgentProfile;
const scenario = (id: string) => scenarios.find((s) => s.id === id) as Scenario;

const files = readdirSync(join(ROOT, "eval/recordings")).filter((f) => f.endsWith(".json"));
const evalFile = "eval/recordings/2026-10-14-eval.json";
const scenarioFile = "eval/recordings/2026-10-14-scenarios.json";

describe.each(files)("recording %s", (file) => {
  const recording = loadRecording(read(`eval/recordings/${file}`));

  it("re-scores to the published results", async () => {
    for (const model of Object.keys(recording.eval)) {
      const { recordedAt, recording: source, ...published } = json(resultPath(recording, model)) as Record<string, unknown>;
      expect(recordedAt).toBe(recording.recordedAt);
      expect(source).toBe(`eval/recordings/${file}`);
      expect(published).toEqual(await scoreRun(model, evalItems(recording, model)));
    }
  });

  it("records each scenario from the input the replay computes today", () => {
    for (const s of scenarios.filter((s) => recording.scenarios[s.id])) {
      const draftStep = s.steps.findIndex((step) => step.type === "draft");
      for (const source of sourcesFor(recording, s)) {
        const { extraction } = outputsFor(recording, s, source);
        const { draftInput } = runSimulation(s, agentOf(s), draftStep, { extraction, draft: null });
        const recorded = recording.scenarios[s.id][source].draft;
        if (draftInput === null) expect(recorded).toBeNull();
        else expect(recorded?.input).toEqual(draftInput);
      }
    }
  });
});

describe("the scenario recording", () => {
  const recording = loadRecording(read(scenarioFile));

  it("holds every scenario, from every model and the hand-made answer", () => {
    expect(Object.keys(recording.scenarios).sort()).toEqual(scenarios.map((s) => s.id).sort());
    for (const s of scenarios) {
      const expected = [...recording.models, ...(s.handMade ? [HAND_MADE] : [])];
      expect(sourcesFor(recording, s)).toEqual(expected);
      for (const model of recording.models) expect(recording.scenarios[s.id][model].extraction?.ok).toBe(true);
    }
  });

  it("backs the notes: no model took the agent's, the friend's or the Singapore budget", () => {
    for (const id of ["agent-floats-budget", "friends-budget", "singapore-budget"]) {
      for (const model of recording.models) {
        expect(outputsFor(recording, scenario(id), model).extraction?.budgetIDR.value).toBeNull();
      }
    }
  });

  it("backs the Singapore note: the writer gets IDR 1.5 billion, the check holds the draft for Tampines", () => {
    const s = scenario("singapore-budget");
    for (const model of recording.models) {
      const draft = recording.scenarios[s.id][model].draft;
      expect(draft?.input.profile.budgetIDR).toBe(1_500_000_000);
      const sim = runSimulation(s, agentOf(s), s.steps.length - 1, outputsFor(recording, s, model));
      expect(sim.draft).toMatchObject({
        status: "written",
        verdict: { passed: false, violations: ['area "Tampines" not present in the lead profile'] },
      });
    }
  });

  it("backs the hand-made notes: the agent's number is thrown out, the friend's passes", () => {
    const agentFloats = scenario("agent-floats-budget");
    const agentRun = runSimulation(agentFloats, agentOf(agentFloats), agentFloats.steps.length - 1, outputsFor(recording, agentFloats, HAND_MADE));
    expect(agentRun.violations).toEqual([
      { field: "budgetIDR", reason: "citation_from_agent", citation: "budget in the 1.5M range" },
    ]);
    expect(agentRun.profile.budgetIDR).toBeNull();

    const friends = scenario("friends-budget");
    const friendsRun = runSimulation(friends, agentOf(friends), friends.steps.length - 1, outputsFor(recording, friends, HAND_MADE));
    expect(friendsRun.violations).toEqual([]);
    expect(friendsRun.profile.budgetIDR).toBe(500_000_000);
    expect(friendsRun.qualState).toBe("disqualified");
    expect(friendsRun.draft).toEqual({ status: "blocked", reason: "lead explicitly said stop/not interested" });
  });
});

describe("the hand review of the eval", () => {
  const recording = loadRecording(read(evalFile));
  const review = json("eval/review/2026-10-14.json") as {
    recording: string;
    categories: Record<string, string>;
    facts: { model: string; conversation: string; field: string; category: string; why: string }[];
  };

  it("covers exactly the facts the scorer marks wrong, and says which were left empty", async () => {
    expect(review.recording).toBe(evalFile);
    const reviewed = new Map(review.facts.map((f) => [`${f.model} ${f.conversation} ${f.field}`, f]));
    expect(reviewed.size).toBe(review.facts.length);

    let wrong = 0;
    for (const model of recording.models) {
      const report = await scoreRun(model, evalItems(recording, model));
      for (const c of report.perConversation) {
        for (const field of FIELDS) {
          if (c.fieldMatches[field]) continue;
          wrong += 1;
          const fact = reviewed.get(`${model} ${c.id} ${field}`);
          expect(fact, `${model} ${c.id} ${field} is not reviewed`).toBeDefined();
          const empty = field === "areas" ? c.predicted.areas.length === 0 : [null, "unknown"].includes(c.predicted[field] as string | null);
          expect(fact?.category === "missed", `${model} ${c.id} ${field}`).toBe(empty);
          expect(Object.keys(review.categories)).toContain(fact?.category);
          expect(fact?.why.length).toBeGreaterThan(10);
        }
      }
    }
    expect(wrong).toBe(review.facts.length);
  });

  it("is right that the rule-based stage, not the model, gave the friend's purchase as intent", () => {
    for (const model of recording.models) {
      const extraction = recording.eval[model]["c12_adversarial_friend_budget"];
      expect(extraction.ok && extraction.extraction.intent.value).not.toBe("buy");
    }
  });

  it("is right that the guardrail threw out a true area in c07", () => {
    const recorded = recording.eval["cx/gpt-6-luna"]["c07_multi_area_rent_apartment"];
    if (!recorded.ok) throw new Error("expected a readable reply");
    expect(recorded.extraction.areas.value).toEqual(["BSD", "Alam Sutera"]);
    const conversation = evalItems(recording, "cx/gpt-6-luna").find((i) => i.conversation.id === "c07_multi_area_rent_apartment")!.conversation;
    expect(applyGuardrail(recorded.extraction, conversation).violations).toEqual([
      { field: "areas[1]", reason: "missing_citation", citation: null },
    ]);
  });
});

describe("the README", () => {
  it("quotes the published results", async () => {
    const readme = read("README.md");
    const recording = loadRecording(read(evalFile));
    const names: Record<string, string> = { "cx/gpt-6-luna": "GPT-6 Luna", "ag/gemini-3.8-flash": "Gemini 3.8 Flash" };
    for (const model of recording.models) {
      const report = await scoreRun(model, evalItems(recording, model));
      const filled = FIELDS.reduce((n, f) => n + report.perField[f].predictedNonEmpty, 0);
      const wrong = FIELDS.reduce((n, f) => n + report.perField[f].hallucinations, 0);
      const rate = (report.overall.hallucinationRate * 100).toFixed(1);
      expect(readme).toContain(`| ${names[model]} | ${filled} | ${wrong} | ${rate}% |`);
    }
  });

  it("quotes the review's quotes verbatim from the conversations", () => {
    const conversations = json("data/conversations.json") as { id: string; messages: { text: string }[] }[];
    const review = json("eval/review/2026-10-14.json") as { facts: { conversation: string; why: string }[] };
    for (const fact of review.facts) {
      const text = conversations.find((c) => c.id === fact.conversation)!.messages.map((m) => m.text.toLowerCase()).join("\n");
      const quotes = [...fact.why.matchAll(/“([^”]+)”/g)].map((m) => m[1].toLowerCase());
      for (const quote of quotes.filter((q) => /^[a-z0-9 ]+$/.test(q) && q.split(" ").length > 2)) {
        expect(text, `${fact.conversation}: “${quote}”`).toContain(quote);
      }
    }
  });
});
