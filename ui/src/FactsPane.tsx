import type { LeadProfile } from "@pipeline/schema";
import type { QualificationState } from "@pipeline/qualify";
import type { DraftState, FactCitations, SimState } from "@pipeline/replay";
import {
  LEAD_STATE_LABEL,
  QUALIFICATION_LABEL,
  REJECTION_REASON,
  fieldLabel,
  formatBudgetIDR,
} from "./labels";
import { english } from "./glosses";

type FactKey = keyof FactCitations;

const FACT_FIELDS: { key: FactKey; label: string }[] = [
  { key: "budgetIDR", label: "Budget" },
  { key: "areas", label: "Areas" },
  { key: "intent", label: "Intent" },
  { key: "urgency", label: "Urgency" },
  { key: "propertyType", label: "Property type" },
  { key: "timeline", label: "Timeline" },
];

const QUAL_STATES: QualificationState[] = ["new", "qualifying", "qualified", "disqualified", "handed_off"];

function factValueDisplay(profile: LeadProfile, key: FactKey): { text: string; isNull: boolean } {
  if (key === "budgetIDR") {
    return profile.budgetIDR === null
      ? { text: "∅", isNull: true }
      : { text: formatBudgetIDR(profile.budgetIDR), isNull: false };
  }
  if (key === "areas") {
    return profile.areas.length === 0
      ? { text: "∅", isNull: true }
      : { text: profile.areas.join(", "), isNull: false };
  }
  const value = profile[key];
  const isNull = value === null || value === "unknown";
  return { text: isNull ? "∅" : String(value), isNull };
}

function primaryCitation(citations: FactCitations, key: FactKey): string | null {
  return key === "areas" ? (citations.areas[0] ?? null) : citations[key];
}

function extractionLine(sim: SimState): string | null {
  if (sim.extractionStatus === "pending") return "The model reads the chat once the lead has answered the agent's questions.";
  if (sim.extractionStatus === "unreadable") return "The model's reply could not be read, so nothing from it is used.";
  return null;
}

function DraftSection({ draft, writer }: { draft: DraftState; writer: string | null }) {
  if (draft.status === "blocked") {
    return <p className="draft-blocked">No follow-up drafted: {draft.reason}.</p>;
  }
  if (draft.status === "unreadable") {
    return <p className="draft-blocked">The writer's reply could not be read, so there is no draft.</p>;
  }
  return (
    <>
      <blockquote className="lead-card__draft" lang={english(draft.output.message) ? "id" : undefined}>
        {draft.output.message}
        {english(draft.output.message) && (
          <span className="mt-gloss" lang="en">
            {english(draft.output.message)}
          </span>
        )}
      </blockquote>
      {writer && <p className="draft-writer">Written by {writer}.</p>}
      {draft.verdict.passed ? (
        <span className="guardrail guardrail--pass">Passed: its numbers and areas are ones the lead gave, and it fits the agent's style.</span>
      ) : (
        <div className="guardrail guardrail--fail">
          <span>Held back for a person to check:</span>
          <ul>
            {draft.verdict.violations.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

interface FactsPaneProps {
  sim: SimState;
  onFactClick: (citation: string | null) => void;
  /** Shown under the facts: what to look for, and where the model output came from. */
  notes?: string[];
  /** The model that wrote the draft. */
  writer?: string | null;
}

export function FactsPane({ sim, onFactClick, notes = [], writer = null }: FactsPaneProps) {
  const status = extractionLine(sim);

  return (
    <div className="facts-pane">
      <section className="facts-section" aria-label="Facts">
        <h3>Facts, each with the lead's own words</h3>
        <dl className="fact-grid">
          {FACT_FIELDS.map(({ key, label }) => {
            const { text, isNull } = factValueDisplay(sim.profile, key);
            const citation = isNull ? null : primaryCitation(sim.citations, key);
            // areas are glossed one by one: a model may keep a word around a name ("deket De Park")
            const gloss = isNull
              ? null
              : key === "areas"
                ? sim.profile.areas.some((a) => english(a))
                  ? sim.profile.areas.map((a) => english(a) ?? a).join(", ")
                  : null
                : english(text);
            return (
              <div key={key} className="fact-row">
                <dt>{label}</dt>
                <dd>
                  {/* Keyed on the value: a new value mounts a new button, whose CSS
                      animation flashes it once. No state, no effect. */}
                  <button
                    key={text}
                    type="button"
                    className={`fact-value ${isNull ? "fact-value--null" : "fact-value--flash"}`}
                    disabled={citation === null}
                    onClick={() => onFactClick(citation)}
                    lang={gloss ? "id" : undefined}
                    aria-label={citation ? `${label}: ${text}${gloss ? ` (${gloss})` : ""}. Show the message it comes from` : `${label}: none`}
                  >
                    {text}
                  </button>
                  {gloss && (
                    <span className="mt-gloss" lang="en">
                      {gloss}
                    </span>
                  )}
                  {citation && (
                    <q className="fact-quote" lang={english(citation) ? "id" : undefined}>
                      {citation}
                    </q>
                  )}
                  {english(citation) && (
                    <span className="mt-gloss" lang="en">
                      {english(citation)}
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        {status && <p className="facts-note">{status}</p>}

        {sim.violations.length > 0 && (
          <div className="guardrail guardrail--fail">
            <span>Thrown out by the guardrail:</span>
            <ul>
              {sim.violations.map((v, i) => (
                <li key={i}>
                  <button type="button" className="violation-link" onClick={() => onFactClick(v.citation)}>
                    {fieldLabel(v.field)}
                    {v.citation ? <> <q>{v.citation}</q></> : null}: {REJECTION_REASON[v.reason]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {notes.map((note) => (
          <p key={note} className="facts-note facts-note--source">
            {note}
          </p>
        ))}
      </section>

      <section className="facts-section" aria-label="Lead state">
        <h3>Lead state</h3>
        <span className={`badge badge--state-${sim.leadState}`}>{LEAD_STATE_LABEL[sim.leadState]}</span>
      </section>

      <section className="facts-section" aria-label="Qualification">
        <h3>Qualification</h3>
        <div className="qual-strip">
          {QUAL_STATES.map((state) => (
            <span
              key={state}
              className={`qual-chip ${state === sim.qualState ? "qual-chip--active" : ""} qual-chip--${state}`}
            >
              {QUALIFICATION_LABEL[state]}
            </span>
          ))}
        </div>
        {sim.transitions.length > 0 && (
          <ul className="transition-log">
            {sim.transitions.map((t, i) => (
              <li key={i}>
                <strong>{QUALIFICATION_LABEL[t.state]}</strong>: {t.reason}
              </li>
            ))}
          </ul>
        )}
      </section>

      {sim.draft && (
        <section className="facts-section" aria-label="Follow-up draft">
          <h3>Follow-up draft</h3>
          <DraftSection draft={sim.draft} writer={writer} />
        </section>
      )}
    </div>
  );
}
