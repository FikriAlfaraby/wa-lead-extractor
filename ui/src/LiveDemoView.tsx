import { useRef, useState } from "react";
import agentsData from "../../data/agents.json";
import type { AgentProfile, LeadProfile, Message } from "@pipeline/schema";
import type { Violation } from "@pipeline/guardrail";
import type { LeadState } from "@pipeline/classify";
import type { QualificationState } from "@pipeline/qualify";
import { ChatPane } from "./ChatPane";
import { FactsPane } from "./FactsPane";
import { formatProfileSummary } from "./labels";
import type { SimState, FactCitations, DraftResult, Transition } from "./simulate";
import type { LeadRow } from "./types";
import "./Simulator.css";

const agents = agentsData as AgentProfile[];

// ponytail: placeholder for wherever this demo ends up hosted — swap for
// the real deployed Worker URL once one exists.
const DEMO_URL = "https://wa-lead-extractor.example.workers.dev";

const GREETING: Message = {
  speaker: "agent",
  text: "Hi there! Are you looking to buy or rent, or just browsing for now? Happy to help either way.",
};

const SUGGESTED_MESSAGES = [
  "hi, looking for a 3-bedder condo near Tampines MRT, budget around 1.5M can?",
  "quite urgent leh, need to move in by next month",
  "my friend's budget is 500k but I haven't decided mine yet",
];

// Live mode has no per-field citation in the /api/analyze response (that's
// a UI-only affordance the simulator gets from replaying recorded LLM
// output) — so there's nothing to click-to-highlight here. Every fact
// button in FactsPane naturally renders disabled when its citation is null.
const NO_CITATIONS: FactCitations = {
  budgetIDR: null,
  areas: [],
  intent: null,
  urgency: null,
  propertyType: null,
  timeline: null,
};

interface AnalyzeResponse {
  profile: LeadProfile;
  guardrailViolations: Violation[];
  leadState: LeadState;
  qualification: { state: QualificationState; trajectory: Transition[] };
}

interface DraftResponse {
  draft: DraftResult["output"];
  verdict: DraftResult["verdict"];
  agent: { id: string; name: string };
}

type BackendError = "rate_limited" | "unavailable" | null;

function hasAnyProfileFact(profile: LeadProfile): boolean {
  return (
    profile.budgetIDR !== null ||
    profile.areas.length > 0 ||
    profile.intent !== "unknown" ||
    profile.urgency !== "unknown" ||
    profile.propertyType !== null ||
    profile.timeline !== null
  );
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: BackendError }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if (!res.ok) return { ok: false, error: "unavailable" };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export function LiveDemoView({ onAddToQueue }: { onAddToQueue: (row: LeadRow) => void }) {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<BackendError>(null);
  const [agentId, setAgentId] = useState(agents[0].id);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [draftPending, setDraftPending] = useState(false);
  const [sentToQueue, setSentToQueue] = useState(false);
  const baseTime = useRef(new Date()).current;

  const sendLeadMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    const nextMessages = [...messages, { speaker: "lead" as const, text: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setPending(true);
    setError(null);
    const result = await postJson<AnalyzeResponse>("/api/analyze", { messages: nextMessages });
    if (result.ok) {
      setAnalysis(result.data);
    } else {
      setError(result.error);
    }
    setPending(false);
  };

  const generateFollowUp = async () => {
    if (!analysis || draftPending) return;
    setDraftPending(true);
    setError(null);
    const result = await postJson<DraftResponse>("/api/draft", {
      profile: analysis.profile,
      agentId,
      leadState: analysis.leadState,
    });
    if (result.ok) {
      setDraft({ output: result.data.draft, verdict: result.data.verdict });
      setSentToQueue(false);
    } else {
      setError(result.error);
    }
    setDraftPending(false);
  };

  const sim: SimState | null = analysis && {
    conversation: { id: "live-demo", messages },
    profile: analysis.profile,
    citations: NO_CITATIONS,
    violations: analysis.guardrailViolations,
    extractionNote: null,
    leadState: analysis.leadState,
    qualState: analysis.qualification.state,
    transitions: analysis.qualification.trajectory,
    draft,
    isComplete: true,
  };

  const handleSendToQueue = () => {
    if (!sim?.draft) return;
    const agent = agents.find((a) => a.id === agentId) ?? agents[0];
    onAddToQueue({
      id: `live_${Date.now()}`,
      name: "Live demo lead",
      leadState: sim.leadState,
      qualificationState: sim.qualState,
      qualificationReason: sim.transitions[sim.transitions.length - 1]?.reason ?? "",
      profileSummary: formatProfileSummary(sim.profile),
      agentName: agent.name,
      draftMessage: sim.draft.output.message,
      guardrail: sim.draft.verdict,
    });
    setSentToQueue(true);
  };

  const canGenerateDraft = analysis !== null && hasAnyProfileFact(analysis.profile) && !draftPending;

  return (
    <div className="live-demo-view">
      <header className="app__header">
        <h1>Live demo</h1>
        <p>
          Every response here is the real pipeline running server-side — extraction and drafting
          are live LLM calls, guardrails and state machine are the same code as <code>src/</code>.
        </p>
      </header>

      {error && (
        <div className="live-demo__banner">
          {error === "rate_limited" ? (
            "Demo rate limit reached — try again in a bit."
          ) : (
            <>
              Live mode needs the API backend — run <code>npx wrangler dev</code> locally, or use
              the{" "}
              <a href={DEMO_URL} target="_blank" rel="noopener noreferrer">
                hosted demo
              </a>
              .
            </>
          )}
        </div>
      )}

      <div className="simulator-panes">
        <div className="live-demo__chat">
          <ChatPane
            leadName="Live demo"
            baseTime={baseTime}
            messages={messages}
            typingSpeaker={null}
            highlightedIndex={null}
          />

          <div className="live-demo__suggestions">
            {SUGGESTED_MESSAGES.map((text) => (
              <button
                key={text}
                type="button"
                className="chip"
                disabled={pending}
                onClick={() => sendLeadMessage(text)}
              >
                {text}
              </button>
            ))}
          </div>

          <form
            className="live-demo__composer"
            onSubmit={(e) => {
              e.preventDefault();
              sendLeadMessage(input);
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type as the lead…"
              disabled={pending}
              aria-label="Message as the lead"
            />
            <button type="submit" className="btn btn--approve" disabled={pending || input.trim().length === 0}>
              {pending ? "Sending…" : "Send"}
            </button>
          </form>
        </div>

        <div className="live-demo__facts">
          {sim ? (
            <FactsPane sim={sim} onFactClick={() => {}} />
          ) : (
            <div className="facts-pane">
              <section className="facts-section">
                <p className="empty">Send a message as the lead to see extracted facts.</p>
              </section>
            </div>
          )}

          <section className="facts-section live-demo__followup">
            <h3>Generate follow-up</h3>
            <label className="live-demo__agent-picker">
              Agent
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.voice.language === "id" ? "Bahasa Indonesia" : "English (SG)"}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn--approve" disabled={!canGenerateDraft} onClick={generateFollowUp}>
              {draftPending ? "Generating…" : "Generate follow-up"}
            </button>

            {draft &&
              (sentToQueue ? (
                <p className="lead-card__footnote">Sent — check the Queue tab.</p>
              ) : (
                <button type="button" className="btn btn--send-to-queue" onClick={handleSendToQueue}>
                  Send to approval queue →
                </button>
              ))}
          </section>
        </div>
      </div>
    </div>
  );
}
