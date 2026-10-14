import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { outputsFor, runSimulation, sourcesFor } from "../src/replay.js";
import { ScenarioSchema } from "../src/scenario.js";
import { AgentProfileSchema } from "../src/schema.js";
import { loadRecording } from "./recording.js";

/**
 * Prints, as JSON, how each scenario ends for each source in a scenario
 * recording: the facts, what the guardrail threw out, the qualification
 * and the draft with its verdict. fikrialfaraby.com reads this to check the
 * sentences it writes about the simulator.
 *
 * Usage: tsx eval/scenario-outcomes.ts eval/recordings/<date>-scenarios.json
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), "utf-8"));

const file = process.argv[2];
if (!file) {
  console.error("Usage: tsx eval/scenario-outcomes.ts <scenario-recording.json>");
  process.exit(2);
}
const recording = loadRecording(readFileSync(file, "utf-8"));
const scenarios = (readJson("data/scenarios.json") as unknown[]).map((s) => ScenarioSchema.parse(s));
const agents = (readJson("data/agents.json") as unknown[]).map((a) => AgentProfileSchema.parse(a));

const outcomes = scenarios.flatMap((scenario) => {
  const agent = agents.find((a) => a.id === scenario.agentId);
  if (!agent) throw new Error(`scenario "${scenario.id}" names unknown agent "${scenario.agentId}"`);
  return sourcesFor(recording, scenario).map((source) => {
    const sim = runSimulation(scenario, agent, scenario.steps.length - 1, outputsFor(recording, scenario, source));
    return {
      scenario: scenario.id,
      title: scenario.title,
      source,
      profile: sim.profile,
      rejected: sim.violations,
      qualification: sim.qualState,
      draft: sim.draft,
    };
  });
});

console.log(JSON.stringify({ recordedAt: recording.recordedAt, models: recording.models, outcomes }, null, 2));
