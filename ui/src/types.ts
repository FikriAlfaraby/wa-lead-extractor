export type LeadState = "new" | "warm" | "cold";

export type QualificationState =
  | "new"
  | "qualifying"
  | "qualified"
  | "disqualified"
  | "handed_off";

export interface GuardrailStatus {
  passed: boolean;
  violations: string[];
}

export interface LeadRow {
  id: string;
  name: string;
  leadState: LeadState;
  qualificationState: QualificationState;
  qualificationReason: string;
  profileSummary: string;
  agentName: string;
  draftMessage: string;
  guardrail: GuardrailStatus;
}
