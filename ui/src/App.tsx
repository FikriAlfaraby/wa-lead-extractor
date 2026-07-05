import { useState } from "react";
import fixturesData from "./fixtures.json";
import type { LeadRow } from "./types";
import { LiveDemoView } from "./LiveDemoView";
import { SimulatorView } from "./SimulatorView";
import { QueueView } from "./QueueView";
import "./App.css";

const fixtures = fixturesData as LeadRow[];

type Tab = "live" | "simulator" | "queue";

function App() {
  const [tab, setTab] = useState<Tab>("live");
  const [simulatedLeads, setSimulatedLeads] = useState<LeadRow[]>([]);

  const leads = [...fixtures, ...simulatedLeads];
  const addToQueue = (row: LeadRow) => setSimulatedLeads((prev) => [row, ...prev]);

  return (
    <div className="app">
      <nav className="tab-bar" aria-label="Views">
        <button type="button" className={`tab ${tab === "live" ? "tab--active" : ""}`} onClick={() => setTab("live")}>
          Live demo
        </button>
        <button
          type="button"
          className={`tab ${tab === "simulator" ? "tab--active" : ""}`}
          onClick={() => setTab("simulator")}
        >
          Simulator
        </button>
        <button type="button" className={`tab ${tab === "queue" ? "tab--active" : ""}`} onClick={() => setTab("queue")}>
          Queue {simulatedLeads.length > 0 && <span className="count">{leads.length}</span>}
        </button>
      </nav>

      {tab === "live" && <LiveDemoView onAddToQueue={addToQueue} />}
      {tab === "simulator" && <SimulatorView onAddToQueue={addToQueue} />}
      {tab === "queue" && <QueueView leads={leads} />}

      <footer className="app-footer">
        Deterministic stages run live in your browser — the same production code from{" "}
        <code>src/</code>. Simulator LLM outputs are recorded from real pipeline runs; Live demo
        calls the real Worker API for a live extraction/draft. Number/locale conventions are
        per-market configuration; this demo pipeline currently runs the Indonesian convention (jt =
        million, M/miliar = billion, comma decimals), so &ldquo;1.5M&rdquo; parses as 1.5 billion
        IDR.
      </footer>
    </div>
  );
}

export default App;
