import type { AgentProfile, LeadProfile } from "@pipeline/schema";
import type { Scenario } from "./scenarios";
import type { SimState } from "./simulate";
import type { LeadRow } from "./types";

export const LEAD_STATE_LABEL: Record<LeadRow["leadState"], string> = {
  new: "New",
  warm: "Warm",
  cold: "Cold",
};

export const QUALIFICATION_LABEL: Record<LeadRow["qualificationState"], string> = {
  new: "New",
  qualifying: "Qualifying",
  qualified: "Qualified",
  disqualified: "Disqualified",
  handed_off: "Handed off",
};

export function formatBudgetIDR(value: number | null): string {
  if (value === null) return "∅";
  if (value % 1_000_000_000 === 0) return `Rp ${value / 1_000_000_000}B`;
  if (value >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(1)}B`;
  if (value % 1_000_000 === 0) return `Rp ${value / 1_000_000}jt`;
  return `Rp ${value.toLocaleString("id-ID")}`;
}

export function formatProfileSummary(profile: LeadProfile): string {
  const parts: string[] = [];
  if (profile.intent !== "unknown") parts.push(profile.intent === "buy" ? "Buy" : "Rent");
  if (profile.areas.length > 0) parts.push(profile.areas.join("/"));
  if (profile.budgetIDR !== null) parts.push(formatBudgetIDR(profile.budgetIDR));
  if (profile.urgency !== "unknown") parts.push(`${profile.urgency} urgency`);
  const tail = [profile.propertyType, profile.timeline].filter(Boolean).join(", ");
  if (tail) parts.push(tail);
  return parts.length > 0 ? parts.join(" · ") : "No facts extracted yet";
}

/** Turns a completed simulation run into the same row shape the Queue tab renders. */
export function buildLeadRow(scenario: Scenario, agent: AgentProfile, sim: SimState): LeadRow {
  return {
    id: `sim_${scenario.id}_${Date.now()}`,
    name: scenario.leadName,
    leadState: sim.leadState,
    qualificationState: sim.qualState,
    qualificationReason: sim.transitions[sim.transitions.length - 1]?.reason ?? "",
    profileSummary: formatProfileSummary(sim.profile),
    agentName: agent.name,
    draftMessage: sim.draft?.output.message ?? "(no draft yet)",
    guardrail: sim.draft?.verdict ?? { passed: true, violations: [] },
  };
}
