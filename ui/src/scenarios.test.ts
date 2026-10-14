import { describe, it, expect } from "vitest";
import agentsData from "../../data/agents.json";
import type { AgentProfile } from "@pipeline/schema";
import { outputsFor, runSimulation, sourcesFor } from "@pipeline/replay";
import { HAND_MADE } from "@pipeline/scenario";
import { RECORDING, SCENARIOS } from "./scenarios";

const agents = agentsData as AgentProfile[];

/**
 * What the browser bundle loads: the scenarios and the scenario part of the
 * recording, through the same schemas the recorder wrote them with. The
 * claims the notes make are tested at the root (test/recordings.test.ts);
 * this checks the UI's own wiring.
 */
describe("the simulator's data", () => {
  it("loads four scenarios and two recorded models", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(["clear-buyer", "agent-floats-budget", "friends-budget", "singapore-budget"]);
    expect(RECORDING.models).toEqual(["cx/gpt-6-luna", "ag/gemini-3.8-flash"]);
  });

  it("replays every scenario from every source to the end", () => {
    for (const scenario of SCENARIOS) {
      const agent = agents.find((a) => a.id === scenario.agentId);
      expect(agent).toBeDefined();
      for (const source of sourcesFor(RECORDING, scenario)) {
        const sim = runSimulation(scenario, agent as AgentProfile, scenario.steps.length - 1, outputsFor(RECORDING, scenario, source));
        expect(sim.isComplete).toBe(true);
        expect(sim.extractionStatus).toBe("read");
        expect(sim.draft).not.toBeNull();
        if (sim.qualState === "disqualified") expect(sim.draft?.status).toBe("blocked");
        else expect(sim.draft?.status).toBe("written");
      }
    }
  });

  it("offers the hand-made answer only where a scenario has one", () => {
    for (const scenario of SCENARIOS) {
      expect(sourcesFor(RECORDING, scenario).includes(HAND_MADE)).toBe(scenario.handMade !== undefined);
    }
  });

  it("keeps the eval runs out of the bundle", () => {
    expect(Object.keys(RECORDING).sort()).toEqual(["gateway", "models", "recordedAt", "scenarios"]);
  });
});
