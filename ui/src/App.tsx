import { useMemo, useState } from "react";
import fixturesData from "./fixtures.json";
import type { LeadRow } from "./types";
import "./App.css";

const fixtures = fixturesData as LeadRow[];

type RowStatus = "pending" | "approved" | "rejected";

const LEAD_STATE_LABEL: Record<LeadRow["leadState"], string> = {
  new: "New",
  warm: "Warm",
  cold: "Cold",
};

const QUALIFICATION_LABEL: Record<LeadRow["qualificationState"], string> = {
  new: "New",
  qualifying: "Qualifying",
  qualified: "Qualified",
  disqualified: "Disqualified",
  handed_off: "Handed off",
};

function LeadCard({
  lead,
  status,
  onApprove,
  onReject,
}: {
  lead: LeadRow;
  status: RowStatus;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <article className={`lead-card lead-card--${status}`}>
      <header className="lead-card__header">
        <div className="lead-card__identity">
          <h3>{lead.name}</h3>
          <span className={`badge badge--state-${lead.leadState}`}>
            {LEAD_STATE_LABEL[lead.leadState]}
          </span>
          <span className={`badge badge--qual-${lead.qualificationState}`}>
            {QUALIFICATION_LABEL[lead.qualificationState]}
          </span>
        </div>
        <span className="lead-card__agent">via {lead.agentName}</span>
      </header>

      <p className="lead-card__profile">{lead.profileSummary}</p>
      <p className="lead-card__reason">{lead.qualificationReason}</p>

      <blockquote className="lead-card__draft">{lead.draftMessage}</blockquote>

      <div className="lead-card__guardrail">
        {lead.guardrail.passed ? (
          <span className="guardrail guardrail--pass">Guardrail: passed</span>
        ) : (
          <div className="guardrail guardrail--fail">
            <span>Guardrail: {lead.guardrail.violations.length} violation(s)</span>
            <ul>
              {lead.guardrail.violations.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {status === "pending" && (
        <div className="lead-card__actions">
          <button type="button" className="btn btn--approve" onClick={() => onApprove(lead.id)}>
            Approve &amp; send
          </button>
          <button type="button" className="btn btn--reject" onClick={() => onReject(lead.id)}>
            Reject
          </button>
        </div>
      )}
      {status === "approved" && <p className="lead-card__footnote">Approved — sent to lead.</p>}
      {status === "rejected" && (
        <p className="lead-card__footnote">Rejected — draft needs rework before it can go out.</p>
      )}
    </article>
  );
}

function App() {
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>(() =>
    Object.fromEntries(fixtures.map((lead) => [lead.id, "pending" as RowStatus]))
  );

  const handleApprove = (id: string) => {
    setStatuses((prev) => ({ ...prev, [id]: "approved" }));
  };
  const handleReject = (id: string) => {
    setStatuses((prev) => ({ ...prev, [id]: "rejected" }));
  };

  const grouped = useMemo(() => {
    const pending: LeadRow[] = [];
    const approved: LeadRow[] = [];
    const rejected: LeadRow[] = [];
    for (const lead of fixtures) {
      const status = statuses[lead.id];
      if (status === "approved") approved.push(lead);
      else if (status === "rejected") rejected.push(lead);
      else pending.push(lead);
    }
    return { pending, approved, rejected };
  }, [statuses]);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Follow-up queue</h1>
        <p>
          Every draft below was written by the AI writer and checked by the fact-whitelist
          guardrail. A human still approves or rejects before anything is sent.
        </p>
      </header>

      <section className="app__section">
        <h2>
          Pending review <span className="count">{grouped.pending.length}</span>
        </h2>
        {grouped.pending.length === 0 ? (
          <p className="empty">Queue is clear.</p>
        ) : (
          <div className="lead-list">
            {grouped.pending.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                status="pending"
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>
        )}
      </section>

      <section className="app__section">
        <h2>
          Sent <span className="count">{grouped.approved.length}</span>
        </h2>
        {grouped.approved.length === 0 ? (
          <p className="empty">Nothing approved yet.</p>
        ) : (
          <div className="lead-list">
            {grouped.approved.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                status="approved"
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>
        )}
      </section>

      <section className="app__section">
        <h2>
          Needs rework <span className="count">{grouped.rejected.length}</span>
        </h2>
        {grouped.rejected.length === 0 ? (
          <p className="empty">Nothing rejected.</p>
        ) : (
          <div className="lead-list">
            {grouped.rejected.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                status="rejected"
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default App;
