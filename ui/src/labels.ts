import type { AgentProfile, LeadProfile } from "@pipeline/schema";
import type { Violation } from "@pipeline/guardrail";
import { HAND_MADE, type Scenario } from "@pipeline/scenario";
import type { SimState } from "@pipeline/replay";
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

export const REJECTION_REASON: Record<Violation["reason"], string> = {
  citation_from_agent: "the agent said this, not the lead",
  citation_not_found: "these words are not in the chat",
  missing_citation: "no quote from the lead",
};

const FIELD_LABEL: Record<string, string> = {
  budgetIDR: "Budget",
  areas: "Area",
  intent: "Intent",
  urgency: "Urgency",
  propertyType: "Property type",
  timeline: "Timeline",
};

/** "areas[1]" -> "Area" */
export function fieldLabel(field: string): string {
  return FIELD_LABEL[field.replace(/\[\d+\]$/, "")] ?? field;
}

const MODEL_LABEL: Record<string, string> = {
  "cx/gpt-6-luna": "GPT-6 Luna",
  "ag/gemini-3.8-flash": "Gemini 3.8 Flash",
};

export function sourceLabel(source: string): string {
  if (source === HAND_MADE) return "A wrong answer, by hand";
  return MODEL_LABEL[source] ?? source.slice(source.lastIndexOf("/") + 1);
}

export function formatBudgetIDR(value: number | null): string {
  if (value === null) return "∅";
  // spelled out for English readers: "M" would read as a million, "jt" not at all
  if (value % 1_000_000_000 === 0) return `Rp ${value / 1_000_000_000} billion`;
  if (value >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(1)} billion`;
  if (value % 1_000_000 === 0) return `Rp ${value / 1_000_000} million`;
  return `Rp ${value.toLocaleString("en-US")}`;
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
  const written = sim.draft?.status === "written" ? sim.draft : null;
  return {
    id: `sim_${scenario.id}_${Date.now()}`,
    name: scenario.leadName,
    leadState: sim.leadState,
    qualificationState: sim.qualState,
    qualificationReason: sim.transitions[sim.transitions.length - 1]?.reason ?? "",
    profileSummary: formatProfileSummary(sim.profile),
    agentName: agent.name,
    draftMessage: written?.output.message ?? "(no draft)",
    guardrail: written?.verdict ?? { passed: true, violations: [] },
  };
}
