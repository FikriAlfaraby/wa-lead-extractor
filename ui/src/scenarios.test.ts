import { describe, it, expect } from "vitest";
import agentsData from "../../data/agents.json";
import type { AgentProfile } from "@pipeline/schema";
import { runSimulation } from "./simulate";
import { SCENARIOS } from "./scenarios";

const agents = agentsData as AgentProfile[];

function finalState(scenarioId: string) {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`unknown scenario: ${scenarioId}`);
  const agent = agents.find((a) => a.id === scenario.agentId) ?? agents[0];
  return runSimulation(scenario, agent, scenario.steps.length - 1);
}

/**
 * Guards the thing the task explicitly asked to protect: that the scripted
 * scenarios in scenarios.ts are consistent with the REAL deterministic
 * pipeline (src/guardrail.ts, src/qualify.ts, src/writer-guardrail.ts), not
 * just hand-verified once and left to drift. Runs the real functions
 * against the exact shipped scenario data (via simulate.ts), not a
 * duplicated copy.
 */
describe("scenario scripts stay consistent with the real pipeline code", () => {
  it("scenario 2 (agent floats a budget): the real guardrail rejects the agent-sourced citation", () => {
    const sim = finalState("agent-floats-budget");
    expect(sim.violations).toEqual([
      { field: "budgetIDR", reason: "citation_from_agent", citation: "budget in the 1.5M range" },
    ]);
    expect(sim.profile.budgetIDR).toBeNull();
    // Because the budget never confirms, the real qualify() reducer never
    // crosses the qualified bar — this is the whole point of the scenario.
    expect(sim.qualState).toBe("qualifying");
  });

  it("scenario 1 (happy path): a clean, lead-cited extraction has zero violations and reaches handed_off", () => {
    const sim = finalState("happy-path");
    expect(sim.violations).toEqual([]);
    expect(sim.profile).toEqual({
      budgetIDR: 1_500_000_000,
      areas: ["Tampines"],
      intent: "buy",
      urgency: "high",
      propertyType: "condo",
      timeline: "next month",
    });
    expect(sim.qualState).toBe("handed_off");
  });

  it("scenario 3 (friend's budget): citation check passes (real, lead-sourced text) though the fact is about a friend", () => {
    const sim = finalState("friends-budget");
    expect(sim.violations).toEqual([]);
    expect(sim.profile.budgetIDR).toBe(500_000_000);
    expect(sim.profile.intent).toBe("unknown");
    // The lead opts out mid-scenario; the real qualify() reducer disqualifies.
    expect(sim.qualState).toBe("disqualified");
  });

  it("every scenario's recorded draft passes the real writer guardrail", () => {
    for (const scenario of SCENARIOS) {
      const sim = finalState(scenario.id);
      expect(sim.draft).not.toBeNull();
      expect(sim.draft?.verdict).toEqual({ passed: true, violations: [] });
    }
  });
});
