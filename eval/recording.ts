import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RecordingSchema, type Recording } from "../src/scenario.js";
import { ConversationSchema, LeadProfileSchema } from "../src/schema.js";
import type { EvalItem } from "./score.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), "utf-8"));

export function loadRecording(text: string): Recording {
  return RecordingSchema.parse(JSON.parse(text));
}

/** The eval conversations with their golden profiles and what `model` extracted from each. */
export function evalItems(recording: Recording, model: string): EvalItem[] {
  const golden = readJson("eval/golden.json") as Record<string, unknown>;
  const runs = recording.eval[model];
  if (!runs) throw new Error(`the recording has no eval run for "${model}"`);
  return (readJson("data/conversations.json") as unknown[]).map((raw) => {
    const conversation = ConversationSchema.parse(raw);
    const recorded = runs[conversation.id];
    if (!recorded) throw new Error(`the recording has no "${model}" extraction for ${conversation.id}`);
    return {
      conversation,
      golden: LeadProfileSchema.parse(golden[conversation.id]),
      extraction: recorded.ok ? recorded.extraction : null,
    };
  });
}

/** eval/results/<date>-<model>.json, with the gateway's routing prefix ("cx/") dropped from the model. */
export function resultPath(recording: Recording, model: string): string {
  const name = model.slice(model.lastIndexOf("/") + 1);
  return `eval/results/${recording.recordedAt.slice(0, 10)}-${name}.json`;
}
