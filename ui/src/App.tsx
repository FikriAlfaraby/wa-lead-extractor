import { useState } from "react";
import fixturesData from "./fixtures.json";
import type { LeadRow } from "./types";
import { LiveDemoView } from "./LiveDemoView";
import { SimulatorView } from "./SimulatorView";
import { QueueView } from "./QueueView";
import "./App.css";
import "./Simulator.css";

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
        The checks run in your browser: the same code as <code>src/</code>. The Simulator replays
        model answers recorded from real calls (<code>eval/recordings/</code>); the Live demo calls
        the Worker API. Money is read the Indonesian way (jt = million, M/miliar = billion), so a
        Singapore &ldquo;1.5M&rdquo; is misread as 1.5 billion IDR, as the Simulator shows.
      </footer>
    </div>
  );
}

export default App;
