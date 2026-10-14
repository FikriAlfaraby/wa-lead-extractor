# wa-lead-extractor

## 1. What this is

A thin, end-to-end slice of an AI-driven WhatsApp lead re-engagement product
for property agents: **extract → classify → qualify → write → guardrail →
judge → human approval.**

WhatsApp conversations between property agents and leads are messy: mixed
Bahasa Indonesia and English, typos, voice notes, topic drift, agents who
float numbers the lead never confirms, leads who go quiet for weeks and then
come back. This project takes that mess and turns it into three things a
re-engagement product actually needs:

1. A structured `LeadProfile` (budget, areas, intent, urgency, property
   type, timeline) extracted **without ever stating a fact the lead didn't
   actually say.**
2. A `LeadState`/`QualificationState` read on where the lead stands (new /
   warm / cold; qualifying / qualified / disqualified / handed off) —
   decided deterministically, so it's cheap and auditable.
3. A drafted, on-voice follow-up WhatsApp message for that lead, verified
   against the same anti-hallucination bar as the extraction, then queued
   for a human to approve or reject before anything sends.

Every LLM stage in this pipeline is sandwiched between deterministic code —
that's the design principle the whole thing is built around, and it shows
up twice, for two different failure modes (see §4).

## 2. Pipeline architecture

```
                 ┌────────────────────┐
  conversation → │ [D] deterministic.ts│ → deterministic facts
                 │ regex/rules on      │   (budget, intent, urgency
                 │ LEAD messages only  │    via explicit patterns)
                 └────────────────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ [LLM] extract.ts    │ → { value, citation } per field,
                 │ single call,        │   cite-or-null prompt
                 │ cite-or-null prompt │
                 └────────────────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ [D] guardrail.ts    │ → verified LLM facts
                 │ re-verify every     │   (fabricated/agent-sourced
                 │ citation, no network│    citations nulled + logged)
                 └────────────────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ [D] pipeline.ts     │ → final LeadProfile
                 │ merge: deterministic│
                 │ wins on conflict    │
                 └────────────────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ [D] classify.ts     │ → LeadState
                 │ recency/volume rules│   new | warm | cold
                 └────────────────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ [D] qualify.ts      │ → QualificationState + reason
                 │ pure reducer over   │   new → qualifying →
                 │ profile + signals   │   qualified | disqualified | handed_off
                 └────────────────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ [LLM] writer.ts     │ → draft { message, factsUsed }
                 │ profile + state +   │   one call, per-agent voice,
                 │ agent voice profile │   fact-scoped prompt
                 └────────────────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ [D] writer-guardrail│ → verified draft or violations
                 │ .ts: fact-whitelist,│   (numbers/areas not in profile,
                 │ no network          │    sentence count, emoji policy)
                 └────────────────────┘
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
       ┌────────────────┐   ┌────────────────────┐
       │ [H] approval    │   │ [LLM] judge.ts       │
       │ queue (ui/)     │   │ rubric scoring,       │
       │ send or reject  │   │ eval-only, not a gate │
       └────────────────┘   └────────────────────┘
```

`[D]` = deterministic, no model call. `[LLM]` = model call, always wrapped
by a `[D]` stage before its output is trusted. `[H]` = human in the loop,
the last gate before anything reaches a lead.

## 3. Where I drew the deterministic vs LLM line, and why

Stage 1 (`deterministic.ts`) only handles patterns regex is *actually
reliable at*: explicit Indonesian money shorthand (`800jt`, `1.5M`, `2
miliar`, `Rp 900 juta`), and a small fixed set of intent/urgency keyword
phrases (`mau beli`, `cari sewa`, `bulan ini`, `ASAP`, `tahun depan`, ...).
It deliberately does **not** attempt areas or property type — those need
open-vocabulary understanding (any neighborhood name, any property
description) that a fixed rule set can't cover without becoming an
ever-growing, ever-stale list. The LLM stage (`extract.ts`) exists to cover
exactly that gap, and `pipeline.ts`'s merge policy is: deterministic wins on
conflict — cheaper (it already ran for free), more auditable (a regex match
points at one exact rule), and zero-hallucination by construction (it either
matches the literal pattern or it doesn't).

The same reasoning extends further down the pipeline, to two stages that
didn't exist in the original extractor:

- **Classification and qualification are deterministic** (`classify.ts`,
  `qualify.ts`), not model calls, for the same three reasons plus a fourth
  that matters more here than it did for extraction: **these decisions gate
  a money action.** Whether a lead is "warm" or "cold" decides whether they
  get a soft re-opening or a concrete next-step message; whether a lead is
  "qualified" and "handed_off" decides whether a human agent gets pinged
  right now. Routing that through an LLM call would add latency and cost to
  every single state check (these run far more often than the one-time
  extraction), and would make "why did this lead get handed off" a model
  black-box question instead of a one-line rule lookup. `qualify.ts`'s
  reducer returns a human-readable `reason` string with every transition
  for exactly this auditability reason — the point isn't just correctness,
  it's that a support engineer (or the agent themselves) can look at any
  lead and see *why* the system did what it did.

- **Writing is an LLM stage** (`writer.ts`) because this is where the
  trade-off flips: a templated, deterministic message generator would read
  like a bot on WhatsApp, and "sounds like a human agent, in this agent's
  voice" is precisely the kind of nuance regex cannot produce. This is the
  one stage in the whole pipeline where the LLM's fluency is the point, not
  a gap-filler.

- **Verification is deterministic again** (`writer-guardrail.ts`), because
  trust has to be re-established the same way it is after extraction: never
  let the model's own output stand unchecked. The sandwich pattern — every
  LLM stage wrapped by deterministic validation before and/or after it — is
  the one rule this whole codebase is built around, and it's why the
  architecture diagram above marks `[D]` / `[LLM]` on every single box.

## 4. Anti-hallucination: two guardrails for two failure modes

**`guardrail.ts` (extraction)** verifies that a claimed fact was actually
said, by the lead, in this transcript: every non-null LLM field must carry
a verbatim citation, re-checked (case/whitespace-normalized) against the
real messages, and rejected if it's missing, fabricated, or — the
"agent-voice trap" — sourced from the *agent's* message instead of the
lead's (an agent floats "budget di kisaran 1.5M ya kak" and the lead never
confirms it; a naive extractor happily reports it as the lead's budget
anyway). The failure mode here is **inventing what the lead said.**

**`writer-guardrail.ts` (writing)** verifies something different: that
every concrete fact *in the output* — a number, an area name — already
exists in the already-verified `LeadProfile`. There's no transcript to cite
against here; the risk isn't "did the lead say this", it's "is the agent
about to promise something nobody confirmed" (a price that was never
discussed, an area that was never mentioned, a listing that doesn't exist).
It also enforces the parts of the agent's voice contract that are checkable
mechanically rather than just requested in the prompt: sentence count and
emoji policy.

These need two different designs because they sit on opposite sides of the
LLM call: extraction guardrail rails against inventing *input* (what the
lead meant), writer guardrail rails against inventing *output* (what the
agent claims). A single "does this text appear somewhere" check can't do
both jobs — grounding a citation and grounding a generated claim are
different verification problems.

One limitation carried over from the original design: citation/fact
verification confirms text is *real and correctly sourced*, not that it's
about the *right subject*. A lead saying "my friend's budget was half a
billion" is real, lead-sourced text; only the extraction prompt's explicit
third-party rule catches that, which is why `data/conversations.json`
includes an adversarial case for it, evaluated against golden rather than
asserted as a guardrail unit test.

## 5. Eval methodology

**Extraction evals** (`eval/run-eval.ts`, unchanged): runs the full
pipeline over 12 hand-labeled conversations and reports per-field accuracy,
precision/recall, and — the north-star metric — **hallucination rate**: the
fraction of non-null predictions that are wrong. A system that leaves half
its fields null but never states a false fact beats one with higher
accuracy that occasionally invents a budget; a fabricated "urgent" tag
drives a real, bad sales action. The harness exits non-zero above 0%
hallucination, as a regression gate.

**Record once, score offline.** `eval/record.ts` calls the real prompts and keeps every model
reply in `eval/recordings/`; `eval/score-recording.ts` scores a recording with no network, through
the same `runPipeline` the product uses. A test re-scores every recording and must reproduce the
published results, so the numbers cannot drift from the evidence.

Recorded 14 Oct 2026 through an OpenAI-compatible gateway. Facts counted wrong, of the facts
each model filled in:

| Model | Exact text, before my fixes | Exact text, after | By the word rule |
|---|---:|---:|---:|
| GPT-6 Luna | 13 of 42 (31.0%) | 11 of 41 (26.8%) | 6 of 41 (14.6%) |
| Gemini 3.8 Flash | 10 of 43 (23.3%) | 9 of 42 (21.4%) | 4 of 42 (9.5%) |

All of it fails the 0% gate. Every fact the scorer counted wrong is reviewed against its
conversation in `eval/review/2026-10-14.json`, and a test keeps the review in step with the
scorer. The review found three kinds of trouble:

- **My code, now fixed.** The rule-based stage read "temen gue kmrn baru beli rumah" (my friend
  just bought a house) as the lead's intent to buy; it now drops clauses about a friend or a
  relative. The quote check threw out a true area when one quote named two ("BSD sama Alam
  Sutera"); an area named in another of the lead's area quotes is now kept. The "after" column is
  the same replies run through the fixed code: no model output was re-rolled.
- **The scorer.** Exact comparison counts "rumah tinggal" against "rumah" as invented. The word rule
  (`valuesMatch` in `eval/score.ts`) matches free text when every word of the shorter value is in
  the longer: "BSD City" matches "BSD", but a translation ("studio apartment") or an extra place
  ("deket De Park") still counts as wrong. Budget, intent and urgency stay exact.
- **What is left.** Under the word rule: Luna took a viewing day for a moving date (c05, "weekend
  ini bisa"), which is really wrong; the rest are translations, an extra place the lead did name,
  and labels in the answer key that are themselves debatable (urgency for "still just looking").

The simulator also turned up three defects, fixed the same day: a Singapore "1.5M" (S$1.5 million)
was read as IDR 1.5 billion and repeated in the drafts (conversations now carry a market, and
outside Indonesia only rupiah said as rupiah is read); the draft check held back "a quick
10-minute call" as an ungrounded number, and "Tampines" inside the lead's "Tampines MRT" as an
unknown area. The scenario replies were recorded again after those fixes, because the writer's
input changed.

The July run (`eval/results/2026-07-05-deepseek-v4-flash.json`, 26.7%) kept only the scores, not
the replies, so it cannot be reviewed the same way. `npm run eval` still runs live and writes
`eval/report.json`, which is not committed.

**Message-quality evals** (`eval/run-message-eval.ts`, new): runs
classify → qualify → write → writer-guardrail → judge over 6 selected
conversations × both agent voice profiles (12 combinations), and reports:

- **Guardrail rejection rate** — the fraction of drafts the deterministic
  fact-whitelist guardrail rejected. This is the number that actually
  matters for "can this go out unattended."
- **Per-criterion judge means** (1-5) — `grounded`, `onVoice`, `actionable`,
  `natural` — an LLM-as-judge rubric score, written to
  `eval/message-report.json`.

It deliberately reuses `eval/golden.json` as the `LeadProfile` input instead
of running a fresh extraction call, to isolate writer/judge quality from
extraction accuracy (and to halve the LLM calls per run) — extraction
accuracy is already `run-eval.ts`'s job.

**Honest note on judge reliability:** an LLM judge is not a stable
yardstick. Scores drift across model versions, prompt rewording, and
temperature; a judge can be fooled by fluent-sounding text the same way a
naive extractor can be fooled by real-but-misattributed text. That's
exactly why the judge is explicitly *not* the gate — `writer-guardrail.ts`
is. The judge informs the eval report (is message quality trending up or
down across changes) and is a decent regression signal in aggregate over
many samples, but a single low judge score on a single message is not
grounds to trust or distrust the guardrail's pass/fail call, and a single
high judge score does not mean a message is safe to send un-reviewed.
Treat the judge as a dashboard metric, not a gate — same posture as
"accuracy is not the eval's north star, hallucination rate is" in the
extraction eval.

## 6. Product surface: the Pipeline Simulator and approval queue

The simulator runs on [fikrialfaraby.com/wa-lead](https://fikrialfaraby.com/wa-lead/), built
with `npm run build:embed` in `ui/`. Its conversations are written by hand
(`data/scenarios.json`); every model answer it shows is a recorded reply
(`eval/recordings/2026-10-14-scenarios.json`), from either model, or a wrong answer written by
hand and labelled as such, to show what the guardrail does with a mistake the models did not make.
The deterministic stages replay it in the browser through `src/replay.ts`, the same code the
recorder uses to compute the writer's input. A lead who says stop gets no draft: the writer is never
told, so a gate in `qualify.ts` stops it.

`ui/` also has a **Live demo**, a real interactive chat against the
Worker's `/api/analyze` and `/api/draft` endpoints — type as the lead (or
click a suggested message) and watch actual LLM extraction, the citation
guardrail, and the qualification state machine run server-side, with a
friendly banner if the API backend isn't reachable. The scripted
**Pipeline Simulator** is the second tab: a WhatsApp-style
conversation plays on the left while the right pane shows exactly what the
pipeline sees at each step — extracted facts (click one to jump to its
cited message), the lead-state and qualification state machine with real
transition reasons, and the AI draft with a live guardrail verdict. The
three scripted scenarios exist specifically to make the guardrails' payoff
visible: a clean extraction that sails through, an agent-floated budget the
guardrail visibly rejects, and a friend's-budget citation that passes the
mechanical check but is flagged as the exact attribution gap described in
§4. Deterministic code (`classify.ts`, `qualify.ts`, `guardrail.ts`,
`writer-guardrail.ts`, `deterministic.ts`) is imported straight from `src/`
via a Vite alias and runs for real in the browser on every step; only the
LLM extraction/draft outputs are pre-recorded from real pipeline runs,
since no network calls happen client-side — the footer says so explicitly,
on every screen. A "Send to approval queue" action carries the finished
simulated lead into the second tab, the original **Queue** view, described
below.

`ui/` is a minimal React "follow-up queue": one screen, three sections
(pending review, sent, needs rework), each row showing the lead's state
badge, qualification state and reason, extracted-profile summary, the AI
draft, and the guardrail verdict (with violations listed inline when it
failed). Approve moves a row to "sent"; reject moves it to "needs rework".
It reads from a hand-written fixture file (`ui/src/fixtures.json`) rather
than a live backend — the point of this surface is to demonstrate the
human-in-the-loop approval UX the rest of the pipeline is built to feed,
not to stand up a full application.

**Why human-in-the-loop is the right default here, not a compromise:**
outbound messages to real leads are a different risk class than an internal
extraction report. A wrong `LeadProfile` field is a data quality bug you
catch in eval; a wrong *sent message* is a real person receiving a false
promise from a business, with reputational and (for property price
promises) potentially legal consequences. The guardrail catches ungrounded
facts mechanically, but "does this read right for this specific
relationship" is exactly the kind of judgment a deterministic guardrail and
an LLM judge both fall short of and a human agent doesn't. Full automation
of the *send* step is a reasonable v2 for the lowest-risk lead states (a
"cold" re-opening with a guardrail-clean, high-judge-score draft, say), but
that should be an explicit, measured policy decision made after this queue
has run for a while and produced real approve/reject data — not the
default on day one.

## 7. What I'd build next

- **Real cadence scheduling.** Today, classification and qualification are
  computed on demand for a snapshot in time; a real product needs a
  scheduler that decides *when* to re-check a lead (backing off as a lead
  goes cold, tightening around a `handed_off` SLA) rather than being
  invoked ad hoc.
- **Multi-provider WhatsApp abstraction.** This project assumes a
  conversation transcript already exists; a real system needs webhook
  ingestion from actual WhatsApp Business API providers, provider
  coexistence (agencies rarely run a single BSP), and idempotent message
  delivery with delivery-status tracking.
- **Anti-spam-aware send scheduling.** WhatsApp Business API rate limits
  and quality ratings punish bursty, poorly-timed outbound messages; a
  send scheduler needs to respect per-number throughput limits, local
  business hours per lead's timezone, and back off on quality-rating
  signals from the provider.
- **Per-agent style learning from message history.** `data/agents.json` is
  currently two hand-written style profiles. A real product would derive
  (and keep refreshing) an agent's voice profile from their own sent-message
  history, so `writer.ts` reflects how *that specific agent* actually
  writes rather than a fixed preset.
- **An attribution guardrail**, as noted in §4 — the third-party-fact
  problem (a lead describing someone else's situation) is currently only
  caught by prompt instruction, not verified mechanically.
- **A golden set in the hundreds**, sampled from real anonymized
  conversations with inter-annotator agreement checked, for both the
  extraction eval and the message-quality eval — 12 and 6 conversations
  respectively are enough to make the design defensible, not enough to be
  statistically meaningful benchmarks.

## 8. Quickstart

```bash
# install + run the offline test suite (extraction, classify, qualify,
# writer guardrail, judge schema — all offline, no network, no API key)
npm install
npm run typecheck
npm test

# extraction eval — needs a real OpenAI-compatible endpoint
LLM_API_KEY=sk-... \
LLM_BASE_URL=https://api.openai.com/v1 \
LLM_MODEL=gpt-4o-mini \
npm run eval

# message-quality eval (writer + judge) — same env vars
LLM_API_KEY=sk-... \
LLM_MODEL=gpt-4o-mini \
npm run eval:messages

# record real replies once, then score them with no network
LLM_API_KEY=sk-... LLM_MODELS=gpt-4o-mini RECORD_PARTS=eval \
npm run record -- eval/recordings/<date>-eval.json
npm run score -- eval/recordings/<date>-eval.json

npm run lint     # ESLint, zero warnings

# approval-queue UI (separate package, own deps)
cd ui
npm install
npm run dev      # local dev server
npm run build    # production build, verified in CI
npm run build:embed  # the simulator alone, for the site
```

`LLM_BASE_URL` can point at any OpenAI-compatible chat completions gateway
(OpenAI directly, Azure OpenAI via a compatible proxy, a self-hosted
vLLM/Ollama gateway, etc.) — `src/llm.ts` doesn't hardcode a vendor. Without
`LLM_API_KEY` set, both `npm run eval` and `npm run eval:messages` print
setup instructions and exit 1 rather than failing with a stack trace.

## Data & test notes

- `data/conversations.json` / `eval/golden.json`: 12 hand-labeled
  conversations — 8 normal, 2 sparse (nothing extractable — the system must
  not invent facts just to fill the profile), 2 adversarial (agent-stated
  unconfirmed budget; third-party/friend's budget).
- `data/agents.json`: 2 agent voice profiles — a warm-professional,
  sparing-emoji, English (Singapore) agent, and a casual-direct,
  no-emoji, Bahasa Indonesia agent — deliberately different enough that the
  writer guardrail's voice checks (sentence count, emoji policy) actually
  get exercised in both directions.
- The deterministic stage (`deterministic.ts`) is naive pattern matching
  with no notion of "this fact belongs to someone else"; see
  `test/deterministic.test.ts` for what it does and doesn't catch. Fixed
  keyword lists for intent/urgency will drift as new slang appears — that
  needs periodic manual review of LLM-caught-what-regex-missed cases more
  than it needs machine learning.
