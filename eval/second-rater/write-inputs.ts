import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judgmentItems } from "./items.js";

/**
 * Writes what the second rater sees, and nothing else: each item without the model's name or any
 * label, and each conversation's messages under a neutral name (the scenario notes describe the
 * answer key, so they are left out).
 *
 *   npx tsx eval/second-rater/write-inputs.ts <folder>
 */

const out = process.argv[2];
if (!out) throw new Error("usage: write-inputs.ts <folder>");
mkdirSync(out, { recursive: true });

const conversations = JSON.parse(readFileSync("data/conversations.json", "utf8")) as {
  id: string;
  messages: { speaker: string; text: string }[];
}[];
const items = judgmentItems();
const used = [...new Set(items.map((item) => item.conversation))];
const neutral = new Map(used.map((id, i) => [id, `conversation-${i + 1}`]));

writeFileSync(
  join(out, "items.json"),
  JSON.stringify(
    items.map((item) => ({
      id: item.id,
      conversation: neutral.get(item.conversation),
      field: item.field,
      extracted: item.predicted,
      answerKey: item.expected,
    })),
    null,
    1,
  ) + "\n",
);
writeFileSync(
  join(out, "conversations.json"),
  JSON.stringify(
    conversations
      .filter((c) => neutral.has(c.id))
      .map((c) => ({ name: neutral.get(c.id), messages: c.messages })),
    null,
    1,
  ) + "\n",
);
writeFileSync(join(out, "RULES.md"), readFileSync("eval/second-rater/RULES.md", "utf8"));
console.log(`${out}: ${items.length} items, ${used.length} conversations`);
