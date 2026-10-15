/**
 * English glosses for readers who do not read Indonesian.
 *
 * data/glosses-en.json pairs every Indonesian line that fikrialfaraby.com/wa-lead shows (the 12
 * eval chats and the answer key's words, the simulator's chats, what each model extracted with the
 * lead's words it quoted, and the follow-up it drafted) with an English line, or with null when the
 * line has no Indonesian in it.
 * `problems` checks that a gloss says the same thing: no Indonesian left; every number with its
 * unit (in these chats 1.5M is 1.5 miliar); the leads', agents' and places' names; every weekday;
 * a "not" where the line says belum, bukan or tidak; line breaks and length about the same. It
 * cannot see every change of meaning, so the lines a finding rests on are pinned by hand in
 * test/glosses.test.ts. The pipeline never reads the file: nothing in src/ besides this one names it.
 */

/** Indonesian chat words (and a few Javanese and Sundanese ones) that English never uses. */
const WORDS = `yang yg dan di ke dari untuk utk buat dengan dgn ini itu tidak tdk nggak ngga gak ga gk enggak ya iya
kak ka kakak gan sudah udah udh sdh belum blm belom bisa bs ada aku saya sy gue gw kamu mau juga atau kalau
kalo klo jadi jd sama lagi apa gimana dong aja tapi tp karena krn akan harus pada dalam adalah bahwa hari besok
lusa kemarin kmrn terima kasih makasih silakan silahkan mohon tolong kirim kirimkan berapa brp boleh kok sih
deh nih tuh banget bgt sekarang skrg nanti tadi dulu lebih kurang semua minta pakai pake dapat dapet siap baik
sampai sampe lihat liat cek bentar sebentar bagaimana kenapa kapan mana masih msh sedang hanya cuma saja kami
kita anda dia mereka terus lalu jangan jgn maaf nomor sesuai oke rumah ingin pukul siang pagi malam jadwal
kosong penuh tersedia lantai apartemen kamar teman temen suami istri harga nego sertifikat kayaknya kayanya
kabarin kabari januari februari maret mei juni juli agustus oktober desember senin selasa rabu kamis jumat
sabtu minggu halo pak bu ibu bapak mas mbak selamat betul cocok pilih nama lain langsung waktu jika apakah
sewa beli jual kontrakan cicil cicilan tanah kavling pasti tahun taun bulan depan deket dket dekat cari nyari
pindah tinggal kantor stasiun macet katalog fotonya gapapa kira kira2 sekitar termasuk pajak parkir tergantung
terpisah dibangun sendiri ngumpulin dana eksekusi serius santai bingung opsi tipe dicari kedengeran diketik
telpon beda konteks dikit baru mikir jauh gambaran prioritaskan tunggu pilih2 bangunan preferensi wah oiya
permisi diposting dijadwalkan survey2 compare2 buru2 nyarinya rencananya biasanya juta miliar milyar paling
mentok`.split(/\s+/);
/** Short words that are also English words or names when capitalised ("Hello Dan", "Ada"): they count
 * only in lower case, on both sides. */
const AMBIGUOUS = new Set(["dan", "di", "ke", "ya", "ada", "apa", "mana", "dia", "sama", "mau", "kita", "ka", "ga", "aku", "bs", "baru"]);
const STRICT = new RegExp(`\\b(${WORDS.filter((w) => !AMBIGUOUS.has(w)).join("|")})\\b`, "i");
const LOWER = new RegExp(`\\b(${[...AMBIGUOUS].join("|")})\\b`);
/** warnanya, budgetnya: the -nya forms the list cannot hold one by one (not Kenya, not Tanya). */
const NYA = /\b[a-z]{3,}nya\b/i;
/** Indonesian words that are also English ("jam", "sore", "survey"): they make a line Indonesian, but an
 * English gloss may use them. Months spelt the same in both (April, September, November) count for neither. */
const DETECT_ONLY = /\b(jam|sore)\b/i;
/** A number with the unit that scales it. In these chats "1.5M" is 1.5 miliar: billions of rupiah. */
const AMOUNT = /(?<![\d.,:])(\d+(?:[.,:]\d+)*)(?:\s?(rb|ribu|k|jt|juta|thousand|million|miliar|milyar|billion|bn|m)\b)?/gi;
const ZEROS: Record<string, number> = {
  rb: 3, ribu: 3, k: 3, thousand: 3, jt: 6, juta: 6, million: 6, miliar: 9, milyar: 9, billion: 9, bn: 9, m: 9,
};
/** In chat Indonesian a 2 after a word repeats it: liat2 is liat-liat and dua2nya is dua-duanya, not
 * two. Not after p or x (Rp2.000, x2), and not when more digits follow. */
const REPEAT = /(?<=[a-oq-wyz])2(?![.,]?\d)(?=nya\b|\b)/g;
const DAYS: [RegExp, RegExp, string][] = [
  [/\bsenin\b/i, /\bmon(day)?\b/i, "Monday"],
  [/\bselasa\b/i, /\btue(s|sday)?\b/i, "Tuesday"],
  [/\brabu\b/i, /\bwed(nesday)?\b/i, "Wednesday"],
  [/\bkamis\b/i, /\bthu(rs|rsday)?\b/i, "Thursday"],
  [/\bjumat\b/i, /\bfri(day)?\b/i, "Friday"],
  [/\bsabtu\b/i, /\bsat(urday)?\b/i, "Saturday"],
  // lower-case minggu is also "week"; Minggu, or hari minggu, is Sunday
  [/\bMinggu\b|\bhari minggu\b/, /\bsun(day)?\b/i, "Sunday"],
];
/** A "not": tidak, belum, bukan, jangan. Not ga or gak: in these chats they as often only ask
 * ("ada yg dket stasiun ga", is there one near a station?) as deny. */
const NEGATION = /\b(tidak|tdk|belum|blm|belom|bukan|jangan|jgn)\b/i;
const NOT = /\b(not|no|never|none|nothing|nobody|cannot|without|neither|nor|unsure|undecided|uncertain|longer)\b|n['’]t\b/i;

/** A line is Indonesian when it has one of the words above; the short ones count only in lower case. */
export const isIndonesian = (text: string): boolean =>
  STRICT.test(text) || LOWER.test(text) || NYA.test(text) || DETECT_ONLY.test(text);

function indonesianLeft(gloss: string): string | null {
  return (STRICT.exec(gloss) ?? LOWER.exec(gloss) ?? NYA.exec(gloss))?.[0] ?? null;
}

/** Moves the decimal point `zeros` places right, exactly: ("1", "5", 9) is 1500000000. */
function scaled(whole: string, fraction: string, zeros: number): string {
  const point = whole.length + zeros;
  const digits = (whole + fraction).padEnd(point, "0");
  const int = digits.slice(0, point).replace(/^0+(?=\d)/, "");
  const rest = digits.slice(point).replace(/0+$/, "");
  return rest ? `${int}.${rest}` : int;
}

/** Each number as the value it stands for: 1.5M, 1,5 miliar and 1.5 billion are 1500000000; 15jt and
 * 15 million are 15000000; 10.00 and 10:00 are the time 10:00. */
export function amounts(text: string): string[] {
  const out: string[] = [];
  for (const [, raw = "", unit] of text.replace(REPEAT, "").matchAll(AMOUNT)) {
    const time = /^(\d{1,2})[.:](\d{2})$/.exec(raw);
    if (time && !unit) {
      out.push(`${Number(time[1])}:${time[2]}`);
      continue;
    }
    const groups = raw.split(/[.,:]/);
    const zeros = unit ? (ZEROS[unit.toLowerCase()] ?? 0) : 0;
    if (groups.length === 1 || groups.slice(1).every((g) => g.length === 3)) out.push(scaled(groups.join(""), "", zeros));
    else if (groups.length === 2) out.push(scaled(groups[0] ?? "", groups[1] ?? "", zeros));
    else out.push(...groups.map((g) => String(Number(g))));
  }
  return out;
}

/** Places a gloss may also give in English. */
const PLACES: Record<string, string[]> = { Jaksel: ["Jaksel", "South Jakarta"] };

function jsonProblem(line: string, gloss: string): string | null {
  if (!line.trimStart().startsWith("{")) return null;
  let said: unknown;
  try {
    said = JSON.parse(line);
  } catch {
    return null;
  }
  if (!said || typeof said !== "object" || Array.isArray(said)) return null;
  let meant: unknown;
  try {
    meant = JSON.parse(gloss);
  } catch {
    meant = null;
  }
  const keys = (o: object) => Object.keys(o).sort().join("\n");
  return meant && typeof meant === "object" && !Array.isArray(meant) && keys(meant) === keys(said)
    ? null
    : "the line is a JSON object: the gloss must be the same object with its text in English";
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const breaks = (s: string) => s.split("\n").length - 1;

/** Why a gloss does not stand for its line in English; empty when it does. */
export function problems(line: string, gloss: string | null, keep: string[]): string[] {
  if (gloss === null) return isIndonesian(line) ? ["the line is Indonesian but has no gloss"] : [];
  if (!isIndonesian(line)) return ["the line has no Indonesian in it: it needs no gloss"];
  if (!gloss.trim() || gloss.trim() === line.trim()) return ["the gloss is empty or repeats the line"];
  const found: string[] = [];
  const plain = keep.reduce((text, name) => text.replaceAll(name, " "), gloss);
  const left = indonesianLeft(plain);
  if (left) found.push(`the gloss still has the Indonesian word '${left}'`);
  const english = amounts(gloss);
  const said = amounts(line);
  for (const n of said) if (!english.includes(n)) found.push(`the number ${n} is missing`);
  for (const e of english) if (!said.includes(e)) found.push(`the gloss adds the number ${e}`);
  if (new RegExp(REPEAT.source).test(gloss)) found.push("the gloss keeps a repeated word written with 2 (liat2 means look around)");
  for (const name of keep) {
    if (new RegExp(`(?<!\\w)${escape(name)}(?!\\w)`).test(line) && !(PLACES[name] ?? [name]).some((form) => gloss.includes(form))) {
      found.push(`${name} is missing`);
    }
  }
  if (!line.trimStart().startsWith("{") && (line.split('"').length - gloss.split('"').length) % 2 !== 0) {
    found.push("the gloss has a stray quote mark");
  }
  if (breaks(line) !== breaks(gloss)) found.push(`the gloss has ${breaks(gloss)} line breaks, the line ${breaks(line)}`);
  for (const [day, english, name] of DAYS) if (day.test(line) && !english.test(gloss)) found.push(`${name} is missing`);
  if (NEGATION.test(line) && !NOT.test(gloss)) found.push("the line says not (belum, bukan, tidak…) and the gloss does not");
  const shape = jsonProblem(line, gloss);
  if (shape) found.push(shape);
  const [low, high] = line.length >= 80 ? [0.65, 2.0] : [0.4, 2.5];
  const ratio = gloss.length / line.length;
  if (line.length >= 40 && (ratio < low || ratio > high)) found.push(`the gloss is ${gloss.length} characters for a line of ${line.length}`);
  return [...new Set(found)];
}

/** What the page and the simulator show, as the gloss script and the tests read it. */
export interface Shown {
  conversations: { messages: { text: string }[] }[];
  scenarios: { leadName: string; steps: { type: string; text?: string }[] }[];
  /** scenario id -> model -> what the model extracted and drafted */
  recordings: Record<string, Record<string, { extraction?: unknown; draft?: unknown }>>;
  /** each model's per-chat answers and the answer key */
  results: { perConversation: { predicted: Record<string, unknown>; expected: Record<string, unknown> }[] }[];
  agents: { name: string }[];
}

/** The free-text facts a reader sees in Indonesian: the property type and the timeline. */
const WORDY = ["propertyType", "timeline"];

/** Every distinct line the page and the simulator show a reader, in the order first seen. */
export function shownLines(shown: Shown): string[] {
  const seen = new Set<string>();
  const add = (text: unknown) => {
    if (typeof text === "string" && text.trim()) seen.add(text);
  };
  for (const c of shown.conversations) for (const m of c.messages) add(m.text);
  for (const r of shown.results) {
    for (const c of r.perConversation) {
      for (const field of WORDY) {
        add(c.expected[field]);
        add(c.predicted[field]);
      }
    }
  }
  for (const s of shown.scenarios) for (const step of s.steps) add(step.text);
  for (const byModel of Object.values(shown.recordings)) {
    for (const run of Object.values(byModel)) {
      type Cited = { value?: unknown; citation?: unknown; citations?: unknown[] };
      const extraction = (run.extraction as { extraction?: Record<string, Cited> } | undefined)?.extraction ?? {};
      for (const field of WORDY) add(extraction[field]?.value);
      // the simulator shows the lead's own words under each fact
      for (const fact of Object.values(extraction)) {
        add(fact.citation);
        for (const quote of fact.citations ?? []) add(quote);
      }
      add((run.draft as { output?: { message?: unknown } } | undefined)?.output?.message);
    }
  }
  return [...seen];
}

/** Names a gloss must keep when its line has them: the agents, the simulator's leads (full and first
 * name), and the places the chats name. */
export function names(shown: Shown): string[] {
  const out = new Set<string>(["BSD", "BSD City", "AEON BSD", "Jaksel", "Kemang", "Bintaro", "Alam Sutera", "De Park", "MRT", "IG"]);
  for (const person of [...shown.agents.map((a) => a.name), ...shown.scenarios.map((s) => s.leadName)]) {
    out.add(person);
    const first = person.split(" ")[0];
    if (first) out.add(first);
  }
  return [...out].sort((a, b) => b.length - a.length);
}
