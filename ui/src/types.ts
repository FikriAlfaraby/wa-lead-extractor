// Reuse the real pipeline's state unions instead of hand-duplicating them,
// now that ui/ can import the pure src/ modules directly (see @pipeline
// alias in vite.config.ts / tsconfig.app.json).
import type { LeadState } from "@pipeline/classify";
import type { QualificationState } from "@pipeline/qualify";

export type { LeadState, QualificationState };

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
