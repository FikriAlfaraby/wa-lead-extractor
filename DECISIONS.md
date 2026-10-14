# Decision Log

Design decisions in this repo, with the alternatives I considered and why I
rejected them. Written because in a small team, the *why* is the part the next
reader (human or AI) can't recover from the code alone.

---

## 1. The sandwich pattern: every LLM stage is wrapped by deterministic code

**Decision:** classification and qualification are pure rules; extraction and
writing are LLM stages; verification after each LLM stage is deterministic again.

**Alternative considered:** one big LLM call that reads the conversation and
decides everything (state, qualification, message) — simpler, fewer moving parts.

**Why rejected:** the decisions that gate real actions (is this lead qualified?
should we send?) need to be cheap, auditable, and reproducible. A wrong
extraction is a bad data point; a wrong *send decision* is a spammed customer
and an unhealthy WhatsApp number. Rules gate actions; LLMs handle nuance.

## 2. Two guardrails, two failure modes

**Decision:** extraction uses *cite-or-null* (every fact needs a verbatim,
speaker-verified quote); generation uses a *fact whitelist* (the writer may only
reference facts already in the profile).

**Alternative considered:** reuse the citation check for generated messages.

**Why rejected:** they fail in opposite directions. Extraction fails by
*importing* facts that were never said (or said by the wrong person — the
agent-voice trap). Generation fails by *inventing* facts to sound helpful.
Citation-checking can't catch invention, whitelisting can't catch
misattribution. One check cannot do both jobs.

## 3. Deterministic wins on merge conflicts

**Decision:** when the regex stage and the LLM stage disagree (e.g. budget),
the deterministic value wins.

**Why:** the regex only fires on explicit, unambiguous patterns — when it
fires, it's right or the input was adversarial in a way we want surfaced, not
papered over. The LLM adds coverage, never overrides certainty.

## 4. Lenient schema at the parsing boundary

**Decision:** the Zod schema for LLM output accepts `null` where the type wants
`[]` and normalizes (`.nullable().transform(v => v ?? [])`).

**Why:** learned from the first real eval run — the model returned
`areas: null` and the strict schema turned a semantically-correct answer into a
pipeline crash. Boundary contracts with LLMs should be lenient in what they
accept and strict in what they emit downstream.

## 5. Small adversarial golden set over a large random one

**Decision:** 12 conversations, of which 2 sparse and 2 adversarial
(agent-floats-a-budget; friend's-budget-mentioned).

**Alternative considered:** generate 200 synthetic conversations for volume.

**Why rejected:** for a trust-sensitive extractor, the informative cases are
the ones designed to trigger false extraction. A large random set inflates
accuracy while the failure modes stay untested. Hand-labeled adversarial cases
are worth more per row.

## 6. Hallucination rate is the north-star metric, and the gate exits non-zero

**Decision:** the eval's regression gate fails on hallucination rate > 0, not
on accuracy below a threshold.

**Why:** for a system that messages real customers, a *wrong* fact costs more
than a *missing* one. A missing budget means one more qualifying question; an
invented one means a broken conversation and a burned lead.

## 7. The LLM judge never holds the gate

**Decision:** LLM-as-judge scores message quality (groundedness, voice,
actionability) but cannot approve a message; the deterministic writer-guardrail
holds the gate.

**Why:** a second LLM policing the first inherits the same failure class —
judges drift across model versions and can be charmed by fluent output. Judges
inform; rules gate.

## 8. Human approval queue as the default for outbound

**Decision:** the UI is an approval queue, not an autopilot dashboard.

**Why:** for outbound messages to real leads, human-in-the-loop isn't a
limitation to engineer away — it's the correct trust boundary while eval
coverage matures. Agents stay in control of every real conversation.

## 9. SEA money conventions encoded explicitly

**Decision:** `jt`/`juta` = ×10⁶, `M`/`miliar` = ×10⁹ — so `1.5M` parses as
1.5 *billion* IDR, matching how Indonesian property chat uses "M".

**Known gap (found 14 Oct 2026 by recording real replies):** Singapore chat uses "M" for million,
in Singapore dollars, so a Singapore "1.5M" is misread as IDR 1.5 billion and reaches the draft.
Money rules need to be per market.

**Why it matters:** a US-trained assumption (`M` = million) silently corrupts
every budget by 1000×. Domain conventions belong in code, tested, not in tribal
knowledge.

## 10. What I deliberately did not build (and the upgrade path)

- **Cadence scheduling** — needs real send-history data to be honest; next step
  is a per-lead-state schedule with anti-spam-aware jitter.
- **Multi-provider WhatsApp abstraction** — webhook ingestion + provider
  coexistence is an integration project, not a work-sample; I'd start from a
  provider-agnostic message envelope and idempotent inbound processing.
- **Area entity linking** — the writer-guardrail uses a small gazetteer;
  the honest upgrade is alias-aware entity resolution (the eval already showed
  "Jaksel" vs "Jakarta Selatan" mismatches).
- **Fuzzy citation matching** — paraphrased citations currently pass or fail on
  exact normalized substrings; embedding-similarity matching is the next rung.
