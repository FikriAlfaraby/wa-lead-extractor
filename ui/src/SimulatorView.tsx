import { useEffect, useId, useMemo, useState } from "react";
import agentsData from "../../data/agents.json";
import type { AgentProfile } from "@pipeline/schema";
import { HAND_MADE, type Scenario } from "@pipeline/scenario";
import { findMessageIndex, outputsFor, runSimulation, sourcesFor } from "@pipeline/replay";
import { RECORDING, SCENARIOS } from "./scenarios";
import { buildLeadRow, sourceLabel } from "./labels";
import type { LeadRow } from "./types";
import { ChatPane } from "./ChatPane";
import { FactsPane } from "./FactsPane";

const agents = agentsData as AgentProfile[];

// Cadence: a message step waits this long in total before the NEXT message
// appears, split into a silent pause plus a typing indicator. Model steps
// just wait a shorter fixed beat — there's no "typing" for a panel update.
const MESSAGE_DELAY_MS = 1200;
const STEP_DELAY_MS = 900;
const TYPING_MS = 550;
const HIGHLIGHT_MS = 1000;

const RECORDED_ON = new Date(RECORDING.recordedAt).toLocaleDateString("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

function sourceNotes(scenario: Scenario, source: string): string[] {
  if (source === HAND_MADE) return [scenario.handMade?.note ?? "", "The checks run in your browser."];
  return [
    ...(scenario.note ? [scenario.note] : []),
    `${sourceLabel(source)}'s answers, recorded on ${RECORDED_ON}. The checks run in your browser.`,
  ];
}

function SimulatorRun({
  scenario,
  agent,
  source,
  onRestart,
  onAddToQueue,
}: {
  scenario: Scenario;
  agent: AgentProfile;
  source: string;
  onRestart: () => void;
  onAddToQueue?: (row: LeadRow) => void;
}) {
  const lastStep = scenario.steps.length - 1;
  const [reduceMotion] = useState(prefersReducedMotion);
  const [stepIndex, setStepIndex] = useState(reduceMotion ? lastStep : -1);
  const [playing, setPlaying] = useState(!reduceMotion);
  const [pendingSpeaker, setPendingSpeaker] = useState<"lead" | "agent" | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [sentToQueue, setSentToQueue] = useState(false);
  const [baseTime] = useState(() => new Date());

  const outputs = useMemo(() => outputsFor(RECORDING, scenario, source), [scenario, source]);
  const writer = RECORDING.scenarios[scenario.id]?.[source]?.draft?.writer ?? null;

  useEffect(() => {
    if (!playing || stepIndex >= lastStep) return;
    const next = scenario.steps[stepIndex + 1];
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (next.type === "message") {
      timers.push(
        setTimeout(() => {
          setPendingSpeaker(next.speaker);
          timers.push(
            setTimeout(() => {
              setPendingSpeaker(null);
              setStepIndex((i) => i + 1);
            }, TYPING_MS)
          );
        }, MESSAGE_DELAY_MS - TYPING_MS)
      );
    } else {
      timers.push(setTimeout(() => setStepIndex((i) => i + 1), STEP_DELAY_MS));
    }

    return () => timers.forEach(clearTimeout);
  }, [playing, stepIndex, scenario, lastStep]);

  useEffect(() => {
    if (highlightedIndex === null) return;
    const timer = setTimeout(() => setHighlightedIndex(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightedIndex]);

  const sim = useMemo(() => runSimulation(scenario, agent, stepIndex, outputs), [scenario, agent, stepIndex, outputs]);

  const jumpTo = (index: number) => {
    setPlaying(false);
    setPendingSpeaker(null);
    setStepIndex(Math.min(index, lastStep));
  };

  return (
    <div className="simulator-run">
      <div className="playback-controls">
        <button
          type="button"
          className="btn btn--approve"
          onClick={() => setPlaying((p) => !p)}
          disabled={sim.isComplete}
        >
          {playing && !sim.isComplete ? "Pause" : "Play"}
        </button>
        <button type="button" className="btn btn--reject" onClick={() => jumpTo(stepIndex + 1)} disabled={sim.isComplete}>
          Next step
        </button>
        <button type="button" className="btn btn--reject" onClick={() => jumpTo(lastStep)} disabled={sim.isComplete}>
          Show all
        </button>
        <button type="button" className="btn btn--reject" onClick={onRestart}>
          Restart
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
        <FactsPane
          sim={sim}
          onFactClick={(citation) => setHighlightedIndex(findMessageIndex(sim.conversation.messages, citation))}
          notes={sim.extractionStatus === "pending" ? [] : sourceNotes(scenario, source)}
          writer={writer ? sourceLabel(writer) : null}
        />
      </div>

      {onAddToQueue && sim.isComplete && sim.draft?.status === "written" && (
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
              Send to approval queue
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function SimulatorView({
  onAddToQueue,
  showHeader = true,
  initialScenarioId,
}: {
  onAddToQueue?: (row: LeadRow) => void;
  showHeader?: boolean;
  initialScenarioId?: string;
}) {
  const [scenarioId, setScenarioId] = useState(initialScenarioId ?? SCENARIOS[0].id);
  const [sourceChoice, setSourceChoice] = useState<string>(RECORDING.models[0]);
  const [runNonce, setRunNonce] = useState(0);
  const conversationLabel = useId();
  const sourceLabelId = useId();

  const scenario: Scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const agent: AgentProfile = agents.find((a) => a.id === scenario.agentId) ?? agents[0];
  const sources = sourcesFor(RECORDING, scenario);
  const source = sources.includes(sourceChoice) ? sourceChoice : sources[0];

  const restart = () => setRunNonce((n) => n + 1);

  return (
    <div className="simulator-view">
      {showHeader && (
        <header className="app__header">
          <h1>Pipeline Simulator</h1>
          <p>
            A WhatsApp conversation plays on the left; on the right, what the pipeline sees at each
            step: the facts and their quotes, the lead's state, and the follow-up draft.
          </p>
        </header>
      )}

      <div className="sim-pickers">
        <div className="picker" role="group" aria-labelledby={conversationLabel}>
          <span className="picker__label" id={conversationLabel}>
            Conversation
          </span>
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="picker__option"
              aria-pressed={s.id === scenario.id}
              onClick={() => {
                if (s.id === scenario.id) return;
                setScenarioId(s.id);
                restart();
              }}
            >
              {s.title}
            </button>
          ))}
        </div>
        <p className="picker__blurb">{scenario.blurb}</p>
        <div className="picker" role="group" aria-labelledby={sourceLabelId}>
          <span className="picker__label" id={sourceLabelId}>
            Who reads it
          </span>
          {sources.map((s) => (
            <button
              key={s}
              type="button"
              className={`picker__option ${s === HAND_MADE ? "picker__option--hand" : ""}`}
              aria-pressed={s === source}
              onClick={() => {
                if (s === source) return;
                setSourceChoice(s);
                restart();
              }}
            >
              {sourceLabel(s)}
            </button>
          ))}
        </div>
      </div>

      <SimulatorRun
        key={`${scenario.id}-${source}-${runNonce}`}
        scenario={scenario}
        agent={agent}
        source={source}
        onRestart={restart}
        onAddToQueue={onAddToQueue}
      />
    </div>
  );
}
