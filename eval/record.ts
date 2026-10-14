import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

import { makeLlmExtractFn, type ExtractFn } from "../src/extract.js";
import { makeLlmWriteFn, type WriteFn } from "../src/writer.js";
import { runSimulation } from "../src/replay.js";
import {
  HAND_MADE,
  RecordingSchema,
  ScenarioSchema,
  type RecordedDraft,
  type RecordedExtraction,
  type Recording,
  type Scenario,
} from "../src/scenario.js";
import {
  AgentProfileSchema,
  ConversationSchema,
  type AgentProfile,
  type Conversation,
  type LlmExtraction,
} from "../src/schema.js";

/**
 * Records real model outputs once, so the eval scores and the simulator can
 * replay them later with no network and no API key. Per model it records:
 *   - the extraction for every conversation in data/conversations.json;
 *   - for every scenario in data/scenarios.json, the extraction at its
 *     extract step and the draft at its draft step. The writer's input is
 *     computed by src/replay.ts, the code the simulator runs.
 * For a scenario with a hand-made wrong answer, it also records the draft
 * the first model writes from the profile that answer leaves behind.
 *
 * A reply that cannot be read is recorded as an error. A gateway or network
 * failure stops the run instead: it says nothing about the model.
 *
 * Usage:
 *   LLM_API_KEY=... LLM_BASE_URL=... LLM_MODELS=model-a,model-b \
 *   LLM_GATEWAY_NAME="..." [RECORD_PARTS=eval|scenarios] \
 *   tsx eval/record.ts eval/recordings/<date>-<part>.json
 * RECORD_PARTS records only the eval conversations or only the scenarios,
 * so changing a scenario never re-rolls the eval sample.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), "utf-8"));

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(call: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    if (error instanceof OpenAI.APIError) throw error;
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function recordExtraction(extract: ExtractFn, conversation: Conversation): Promise<RecordedExtraction> {
  const result = await attempt(() => extract(conversation));
  return result.ok ? { ok: true, extraction: result.value } : { ok: false, error: result.error };
}

function conversationAtExtract(scenario: Scenario): Conversation {
  const end = scenario.steps.findIndex((s) => s.type === "extract");
  const messages = scenario.steps
    .slice(0, end === -1 ? scenario.steps.length : end)
    .flatMap((s) => (s.type === "message" ? [{ speaker: s.speaker, text: s.text }] : []));
  return { id: scenario.id, messages };
}

async function recordDraft(
  scenario: Scenario,
  agent: AgentProfile,
  extraction: LlmExtraction | null,
  writer: string,
  write: WriteFn
): Promise<RecordedDraft | null> {
  const draftStep = scenario.steps.findIndex((s) => s.type === "draft");
  if (draftStep === -1) return null;
  const { draftInput: input } = runSimulation(scenario, agent, draftStep, { extraction, draft: null });
  if (!input) return null;
  const result = await attempt(() => write({ profile: input.profile, leadState: input.leadState, agent }));
  return result.ok
    ? { ok: true, writer, input, output: result.value }
    : { ok: false, writer, input, error: result.error };
}

async function main(): Promise<void> {
  const out = process.argv[2];
  const apiKey = process.env.LLM_API_KEY;
  const models = (process.env.LLM_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  if (!out || !apiKey || models.length === 0) {
    console.error("Usage: LLM_API_KEY=... LLM_MODELS=a,b [LLM_BASE_URL=...] tsx eval/record.ts <out.json>");
    process.exit(2);
  }
  const parts = new Set((process.env.RECORD_PARTS ?? "eval,scenarios").split(",").map((p) => p.trim()));
  const baseURL = process.env.LLM_BASE_URL;
  const config = (model: string) => ({ apiKey, baseURL, model });

  const conversations = (readJson("data/conversations.json") as unknown[]).map((c) => ConversationSchema.parse(c));
  const scenarios = (readJson("data/scenarios.json") as unknown[]).map((s) => ScenarioSchema.parse(s));
  const agents = (readJson("data/agents.json") as unknown[]).map((a) => AgentProfileSchema.parse(a));
  const agentOf = (scenario: Scenario): AgentProfile => {
    const agent = agents.find((a) => a.id === scenario.agentId);
    if (!agent) throw new Error(`scenario "${scenario.id}" names unknown agent "${scenario.agentId}"`);
    return agent;
  };

  const evalRuns: Recording["eval"] = {};
  const scenarioRuns: Recording["scenarios"] = parts.has("scenarios")
    ? Object.fromEntries(scenarios.map((s) => [s.id, {}]))
    : {};
  const log = (source: string, id: string, ok: boolean) => console.error(`${source.padEnd(22)} ${id.padEnd(40)} ${ok ? "ok" : "unreadable"}`);

  const perModel = models.map(async (model) => {
    const extract = makeLlmExtractFn(config(model));
    const write = makeLlmWriteFn(config(model));
    if (parts.has("eval")) evalRuns[model] = {};
    for (const conversation of parts.has("eval") ? conversations : []) {
      const recorded = await recordExtraction(extract, conversation);
      evalRuns[model][conversation.id] = recorded;
      log(model, conversation.id, recorded.ok);
    }
    for (const scenario of parts.has("scenarios") ? scenarios : []) {
      const extraction = await recordExtraction(extract, conversationAtExtract(scenario));
      const draft = await recordDraft(scenario, agentOf(scenario), extraction.ok ? extraction.extraction : null, model, write);
      scenarioRuns[scenario.id][model] = { extraction, draft };
      log(model, scenario.id, extraction.ok && (draft === null || draft.ok));
    }
  });

  const handMade = (async () => {
    const writer = models[0];
    const write = makeLlmWriteFn(config(writer));
    for (const scenario of parts.has("scenarios") ? scenarios : []) {
      if (!scenario.handMade) continue;
      const draft = await recordDraft(scenario, agentOf(scenario), scenario.handMade.extraction, writer, write);
      scenarioRuns[scenario.id][HAND_MADE] = { extraction: null, draft };
      log(HAND_MADE, scenario.id, draft === null || draft.ok);
    }
  })();

  await Promise.all([...perModel, handMade]);

  const recording = RecordingSchema.parse({
    recordedAt: new Date().toISOString(),
    gateway: process.env.LLM_GATEWAY_NAME ?? new URL(baseURL ?? "https://api.openai.com/v1").host,
    models,
    eval: evalRuns,
    scenarios: scenarioRuns,
  });
  const path = resolve(out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(recording, null, 2) + "\n");
  console.error(`\nWrote ${out}`);
}

main().catch((err) => {
  console.error("Recording failed:", err);
  process.exit(1);
});
