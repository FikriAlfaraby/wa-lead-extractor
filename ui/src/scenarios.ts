import scenariosData from "../../data/scenarios.json";
import { gateway, models, recordedAt, scenarios } from "../../eval/recordings/2026-10-14-scenarios.json";
import { RecordingSchema, ScenarioSchema, type Scenario } from "@pipeline/scenario";
import type { ScenarioRecording } from "@pipeline/replay";

/**
 * The simulator's conversations, written by hand (data/scenarios.json), and
 * the model outputs it replays, recorded from real calls by eval/record.ts.
 * Both are parsed with the schemas the recorder writes them with. Only the
 * scenario part of the recording is imported, so the eval runs stay out of
 * the browser bundle.
 */
export const SCENARIOS: Scenario[] = ScenarioSchema.array().parse(scenariosData);

export const RECORDING: ScenarioRecording = RecordingSchema.pick({
  recordedAt: true,
  gateway: true,
  models: true,
  scenarios: true,
}).parse({ recordedAt, gateway, models, scenarios });
