import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { printReport, scoreRun } from "./score.js";
import { evalItems, loadRecording, resultPath } from "./recording.js";

/**
 * Scores every model in a recording with no network, and writes one
 * results file per model next to the older runs in eval/results/.
 *
 * Usage: tsx eval/score-recording.ts eval/recordings/<date>.json
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: tsx eval/score-recording.ts <recording.json>");
    process.exit(2);
  }
  const path = resolve(file);
  const recording = loadRecording(readFileSync(path, "utf-8"));
  for (const model of recording.models) {
    const report = await scoreRun(model, evalItems(recording, model));
    printReport(report);
    const out = resultPath(recording, model);
    const published = { recordedAt: recording.recordedAt, recording: relative(ROOT, path), ...report };
    writeFileSync(join(ROOT, out), JSON.stringify(published, null, 2) + "\n");
    console.log(`\nWrote ${out}`);
  }
}

main().catch((err) => {
  console.error("Scoring failed:", err);
  process.exit(1);
});
