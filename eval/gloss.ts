/**
 * Write data/glosses-en.json: an English line for every Indonesian line fikrialfaraby.com/wa-lead
 * shows (src/glosses.ts says which).
 *
 *   LLM_API_KEY=... LLM_BASE_URL=... [LLM_MODEL=cx/gpt-6-luna] tsx eval/gloss.ts
 *
 * Glosses already in the file that pass the checks are kept; only the rest are sent, in batches. A
 * gloss that fails a check is asked for again with the reasons, twice at most; what still fails is
 * listed at the end and left out of the file. A gloss edited by hand is kept as long as it passes the
 * checks (corrected_by_hand says why it was edited).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { names, problems, shownLines, type Shown } from "../src/glosses.js";
import { callLlmJson, loadLlmConfigFromEnv } from "../src/llm.js";

const SYSTEM = `You translate lines from WhatsApp chats into English for readers who do not speak Indonesian. The
chats are between property leads in and around Jakarta and the agents who answer them; some lines are
the facts a model pulled out of a chat (a property type, a timeline) and follow-up messages a model
drafted for the agent. Many are informal WhatsApp Indonesian with abbreviations (yg = yang, udh/sdh =
sudah, blm/belom = belum, gk/ga/gak = tidak, aja = saja, brp = berapa, bgt = banget, kmrn = kemarin,
gue/gw = I, skrg = sekarang, msh = masih, bs = bisa, kalo = kalau, dket/deket = dekat).

Translate each line into natural English that says exactly what the line says: the same facts,
requests and tone (casual stays casual). Do not add, explain or leave out anything.

Words of these chats:
- gan, kak, kakak, mas, mbak, bu, pak, min are forms of address: leave them out, but keep a name
  that follows them.
- sewa = rent; beli = buy; kontrakan = a rented house; KT (3KT) = bedrooms; tanah kavling = a plot
  of land; rumah tinggal = a house to live in; apartemen = apartment; Jaksel = South Jakarta.
- In these chats 1.5M means 1.5 miliar: write 1.5 billion (rupiah). jt/juta = million, rb = thousand.
- bulan ini = this month; bulan depan = next month; minggu ini = this week; tahun depan = next year;
  belum pasti = not decided yet.
- A 2 written after a word repeats the word, it is not the number two: liat2 = look around,
  tanya2 = ask a few things, pilih2 = picky, survey2 = look around, buru2 = in a hurry.
- ga or gak at the end of a question only asks; it is not a "not": "masih available ga?" = "is it
  still available?".
- [image] stays [image].

Keep exactly as written: every number (only rb, jt and M may become thousand, million and billion),
names of people and agents, places (BSD, BSD City, AEON BSD, Kemang, Bintaro, Alam Sutera, De Park),
English words the lead already used, emoji, Markdown and line breaks.

If a line is already entirely in English, return null for it.

You receive a JSON object that maps ids to lines. Answer with one JSON object that maps every id to
its English line (or null), and nothing else.`;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATH = join(ROOT, "data", "glosses-en.json");
const BATCH_CHARS = 5000;
const BATCH_LINES = 20;
const read = <T>(path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8")) as T;

interface GlossFile {
  about: string;
  model: string;
  glosses: Record<string, string | null>;
  corrected_by_hand: Record<string, string>;
}

export function loadShown(): Shown {
  return {
    conversations: read("data/conversations.json"),
    scenarios: read("data/scenarios.json"),
    recordings: read<{ scenarios: Shown["recordings"] }>("eval/recordings/2026-10-14-scenarios.json").scenarios,
    // the page's review table shows each model's answers before the fixes; its summary, after
    results: ["", "before-fixes/"].flatMap((dir) =>
      ["gpt-6-luna", "gemini-3.8-flash"].map((m) => read<Shown["results"][number]>(`eval/results/${dir}2026-10-14-${m}.json`))
    ),
    agents: read("data/agents.json"),
  };
}

async function main() {
  const config = loadLlmConfigFromEnv();
  if (!config) throw new Error("set LLM_API_KEY (and LLM_BASE_URL for a gateway)");
  const model = process.env.LLM_MODEL ?? "cx/gpt-6-luna";
  const shown = loadShown();
  const keep = names(shown);
  const order = shownLines(shown);
  const file: GlossFile = existsSync(PATH)
    ? (JSON.parse(readFileSync(PATH, "utf8")) as GlossFile)
    : { about: "", model, glosses: {}, corrected_by_hand: {} };

  // a refused request stops the run; only an answer that is not JSON counts as none
  const ask = async (content: string): Promise<Record<string, unknown>> => {
    try {
      const answer = await callLlmJson({ ...config, model }, SYSTEM, content);
      return answer && typeof answer === "object" ? (answer as Record<string, unknown>) : {};
    } catch (err) {
      const unreadable = err instanceof SyntaxError || (err instanceof Error && /Could not parse|empty response/.test(err.message));
      if (unreadable) return {};
      throw err;
    }
  };
  const asText = (value: unknown): string | null =>
    typeof value === "string" ? value : value && typeof value === "object" ? JSON.stringify(value) : null;

  const translate = async (lines: string[]): Promise<Map<string, string | null>> => {
    const ids = Object.fromEntries(lines.map((line, i) => [String(i + 1), line]));
    const answer = await ask(JSON.stringify(ids));
    const out = new Map<string, string | null>();
    for (const [key, line] of Object.entries(ids)) {
      let gloss = asText(answer[key]);
      for (let attempt = 0; attempt < 2; attempt++) {
        const found = problems(line, gloss, keep);
        if (!found.length) break;
        gloss = asText(
          (await ask(`Line: ${JSON.stringify(line)}\nYour English: ${JSON.stringify(gloss)}\nProblems: ${found.join("; ")}.\nTranslate the line again. Answer with {"1": "..."} only.`))["1"]
        );
      }
      out.set(line, gloss);
    }
    return out;
  };

  const save = () => {
    const glosses = Object.fromEntries(order.filter((line) => line in file.glosses).map((line) => [line, file.glosses[line] ?? null]));
    const about =
      "English glosses for readers of fikrialfaraby.com/wa-lead. The models saw only the original lines. Written by " +
      "eval/gloss.ts with the model below and checked by test/glosses.test.ts. null: the line has no Indonesian in it.";
    writeFileSync(PATH, `${JSON.stringify({ about, model, glosses, corrected_by_hand: file.corrected_by_hand }, null, 1)}\n`);
  };

  const todo = order.filter((line) => !(line in file.glosses) || problems(line, file.glosses[line] ?? null, keep).length);
  console.log(`${order.length} lines shown, ${order.length - todo.length} glossed already, ${todo.length} to do`);
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of todo) {
    if (current.length && (size + line.length > BATCH_CHARS || current.length >= BATCH_LINES)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length;
  }
  if (current.length) chunks.push(current);
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (let i = next++; i < chunks.length; i = next++) {
      for (const [line, gloss] of await translate(chunks[i] ?? [])) {
        if (!problems(line, gloss, keep).length) file.glosses[line] = gloss;
        else if (!problems(line, null, keep).length) {
          // not Indonesian by the word list: no gloss is needed, but say so where the model translated it
          if (gloss) console.log(`  null, though the model translated it: ${line.slice(0, 80)}`);
          file.glosses[line] = null;
        }
      }
      save();
      console.log(`  batch ${++done}/${chunks.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const failing = order.filter((line) => !(line in file.glosses));
  console.log(`${order.length - failing.length} of ${order.length} lines glossed; ${failing.length} still failing`);
  for (const line of failing.slice(0, 40)) console.log(`  - ${line.slice(0, 160).replace(/\n/g, " ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
