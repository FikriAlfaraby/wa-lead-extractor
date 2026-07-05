import { useEffect, useRef, useState } from "react";
import type { LeadProfile } from "@pipeline/schema";
import type { QualificationState } from "@pipeline/qualify";
import type { SimState, FactCitations } from "./simulate";
import { LEAD_STATE_LABEL, QUALIFICATION_LABEL, formatBudgetIDR } from "./labels";

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

interface FactsPaneProps {
  sim: SimState;
  onFactClick: (citation: string | null) => void;
}

export function FactsPane({ sim, onFactClick }: FactsPaneProps) {
  const prevProfileRef = useRef<LeadProfile>(sim.profile);
  const [flashFields, setFlashFields] = useState<Set<FactKey>>(new Set());

  useEffect(() => {
    const prev = prevProfileRef.current;
    const changed = new Set<FactKey>();
    for (const { key } of FACT_FIELDS) {
      if (JSON.stringify(prev[key as keyof LeadProfile]) !== JSON.stringify(sim.profile[key as keyof LeadProfile])) {
        changed.add(key);
      }
    }
    prevProfileRef.current = sim.profile;
    if (changed.size === 0) return;
    setFlashFields(changed);
    const timer = setTimeout(() => setFlashFields(new Set()), 900);
    return () => clearTimeout(timer);
  }, [sim.profile]);

  return (
    <div className="facts-pane">
      <section className="facts-section">
        <h3>Extracted facts (cite-or-null)</h3>
        <dl className="fact-grid">
          {FACT_FIELDS.map(({ key, label }) => {
            const { text, isNull } = factValueDisplay(sim.profile, key);
            const citation = primaryCitation(sim.citations, key);
            return (
              <div key={key} className="fact-row">
                <dt>{label}</dt>
                <dd>
                  <button
                    type="button"
                    className={`fact-value ${isNull ? "fact-value--null" : ""} ${
                      flashFields.has(key) ? "fact-value--flash" : ""
                    }`}
                    disabled={citation === null}
                    onClick={() => onFactClick(citation)}
                    title={citation ? `Cited: “${citation}”` : "No citation"}
                  >
                    {text}
                  </button>
                </dd>
              </div>
            );
          })}
        </dl>

        {sim.extractionNote && <p className="facts-note">{sim.extractionNote}</p>}

        {sim.violations.length > 0 && (
          <div className="guardrail guardrail--fail">
            <span>Guardrail rejected {sim.violations.length} citation(s):</span>
            <ul>
              {sim.violations.map((v, i) => (
                <li key={i}>
                  <button type="button" className="violation-link" onClick={() => onFactClick(v.citation)}>
                    {v.field}: {v.reason.replace(/_/g, " ")}
                    {v.citation ? ` — “${v.citation}”` : ""}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="facts-section">
        <h3>Lead state</h3>
        <span className={`badge badge--state-${sim.leadState}`}>{LEAD_STATE_LABEL[sim.leadState]}</span>
      </section>

      <section className="facts-section">
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
                <strong>{QUALIFICATION_LABEL[t.state]}</strong> — {t.reason}
              </li>
            ))}
          </ul>
        )}
      </section>

      {sim.draft && (
        <section className="facts-section">
          <h3>AI draft + guardrail</h3>
          <blockquote className="lead-card__draft">{sim.draft.output.message}</blockquote>
          {sim.draft.verdict.passed ? (
            <span className="guardrail guardrail--pass">Guardrail: passed</span>
          ) : (
            <div className="guardrail guardrail--fail">
              <span>Guardrail: {sim.draft.verdict.violations.length} violation(s)</span>
              <ul>
                {sim.draft.verdict.violations.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
