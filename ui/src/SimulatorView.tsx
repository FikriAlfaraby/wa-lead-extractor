import { useEffect, useMemo, useRef, useState } from "react";
import agentsData from "../../data/agents.json";
import type { AgentProfile } from "@pipeline/schema";
import { SCENARIOS, type Scenario } from "./scenarios";
import { runSimulation, findMessageIndex } from "./simulate";
import { buildLeadRow } from "./labels";
import type { LeadRow } from "./types";
import { ChatPane } from "./ChatPane";
import { FactsPane } from "./FactsPane";
import "./Simulator.css";

const agents = agentsData as AgentProfile[];

// Cadence: a message step waits this long in total before the NEXT message
// appears, split into a silent pause plus a typing indicator. Non-message
// (extraction/draft) steps just wait a shorter fixed beat — there's no
// "typing" for a panel update.
const DEFAULT_MESSAGE_DELAY_MS = 1200;
const DEFAULT_STEP_DELAY_MS = 900;
const TYPING_MS = 550;
const HIGHLIGHT_MS = 1000;

function SimulatorRun({
  scenario,
  agent,
  onRestart,
  onAddToQueue,
}: {
  scenario: Scenario;
  agent: AgentProfile;
  onRestart: () => void;
  onAddToQueue: (row: LeadRow) => void;
}) {
  const [stepIndex, setStepIndex] = useState(-1);
  const [playing, setPlaying] = useState(true);
  const [pendingSpeaker, setPendingSpeaker] = useState<"lead" | "agent" | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [sentToQueue, setSentToQueue] = useState(false);
  const baseTime = useRef(new Date()).current;

  useEffect(() => {
    if (!playing || stepIndex >= scenario.steps.length - 1) return;
    const next = scenario.steps[stepIndex + 1];
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (next.type === "message") {
      const total = next.delayMs ?? DEFAULT_MESSAGE_DELAY_MS;
      const preDelay = Math.max(total - TYPING_MS, 0);
      timers.push(
        setTimeout(() => {
          setPendingSpeaker(next.speaker);
          timers.push(
            setTimeout(() => {
              setPendingSpeaker(null);
              setStepIndex((i) => i + 1);
            }, TYPING_MS)
          );
        }, preDelay)
      );
    } else {
      timers.push(setTimeout(() => setStepIndex((i) => i + 1), DEFAULT_STEP_DELAY_MS));
    }

    return () => timers.forEach(clearTimeout);
  }, [playing, stepIndex, scenario]);

  useEffect(() => {
    if (highlightedIndex === null) return;
    const timer = setTimeout(() => setHighlightedIndex(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightedIndex]);

  const sim = useMemo(() => runSimulation(scenario, agent, stepIndex), [scenario, agent, stepIndex]);

  const handleFactClick = (citation: string | null) => {
    setHighlightedIndex(findMessageIndex(sim.conversation.messages, citation));
  };

  const handleNextStep = () => {
    setPlaying(false);
    setPendingSpeaker(null);
    setStepIndex((i) => Math.min(i + 1, scenario.steps.length - 1));
  };

  return (
    <div className="simulator-run">
      <div className="playback-controls">
        <button type="button" className="btn btn--approve" onClick={() => setPlaying((p) => !p)}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button type="button" className="btn btn--reject" onClick={handleNextStep} disabled={sim.isComplete}>
          Next step →
        </button>
        <button type="button" className="btn btn--reject" onClick={onRestart}>
          ⟲ Restart
        </button>
      </div>

      <div className="simulator-panes">
        <ChatPane
          leadName={scenario.leadName}
          baseTime={baseTime}
          messages={sim.conversation.messages}
          typingSpeaker={pendingSpeaker}
          highlightedIndex={highlightedIndex}
        />
        <FactsPane sim={sim} onFactClick={handleFactClick} />
      </div>

      {sim.isComplete && sim.draft && (
        <div className="send-to-queue">
          {sentToQueue ? (
            <p className="lead-card__footnote">Sent — check the Queue tab.</p>
          ) : (
            <button
              type="button"
              className="btn btn--approve btn--send-to-queue"
              onClick={() => {
                onAddToQueue(buildLeadRow(scenario, agent, sim));
                setSentToQueue(true);
              }}
            >
              Send to approval queue →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function SimulatorView({ onAddToQueue }: { onAddToQueue: (row: LeadRow) => void }) {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [runNonce, setRunNonce] = useState(0);

  const scenario: Scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const agent: AgentProfile = agents.find((a) => a.id === scenario.agentId) ?? agents[0];

  const selectScenario = (id: string) => {
    if (id === scenarioId) return;
    setScenarioId(id);
    setRunNonce((n) => n + 1);
  };

  return (
    <div className="simulator-view">
      <header className="app__header">
        <h1>Pipeline Simulator</h1>
        <p>
          Watch a WhatsApp lead conversation play out on the left, and see exactly what the
          pipeline sees — extracted facts, state machine, AI draft, guardrail verdict — on the
          right.
        </p>
      </header>

      <div className="scenario-picker">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`scenario-card ${s.id === scenarioId ? "scenario-card--active" : ""}`}
            onClick={() => selectScenario(s.id)}
          >
            <h4>{s.title}</h4>
            <p>{s.blurb}</p>
          </button>
        ))}
      </div>

      <SimulatorRun
        key={`${scenario.id}-${runNonce}`}
        scenario={scenario}
        agent={agent}
        onRestart={() => setRunNonce((n) => n + 1)}
        onAddToQueue={onAddToQueue}
      />
    </div>
  );
}
