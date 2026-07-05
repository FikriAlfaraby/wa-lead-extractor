/**
 * Cloudflare Worker: the live-demo API in front of the REAL pipeline.
 *
 * The static UI is served via Workers Assets; /api/* executes the same
 * production modules from src/ — nothing is mocked. The LLM key lives in a
 * Worker secret (LLM_API_KEY) and never reaches the browser.
 *
 * Public LLM endpoints get farmed if left open, so this worker ships with
 * per-IP rate limiting and a global daily cap. Cost control is a feature.
 */
import { z } from "zod";
import {
  MessageSchema,
  LeadProfileSchema,
  AgentProfileSchema,
  type Conversation,
  type AgentProfile,
} from "../src/schema.js";
import { runPipeline } from "../src/pipeline.js";
import { makeLlmExtractFn } from "../src/extract.js";
import { loadLlmConfigFromEnv, type LlmConfig } from "../src/llm.js";
import { classifyLead } from "../src/classify.js";
import {
  qualify,
  detectExplicitStop,
  type QualificationState,
  type QualifyResult,
} from "../src/qualify.js";
import { makeLlmWriteFn } from "../src/writer.js";
import { verifyDraft } from "../src/writer-guardrail.js";
import agentsJson from "../data/agents.json";

// --- request schemas (validate at the boundary, always) ---------------------

const AnalyzeRequestSchema = z.object({
  messages: z
    .array(MessageSchema)
    .min(1)
    .max(30)
    .refine(
      (msgs) =>
        msgs.every((m) => m.text.length <= 500) &&
        msgs.reduce((n, m) => n + m.text.length, 0) <= 6000,
      { message: "conversation too large for the demo" }
    ),
});

const DraftRequestSchema = z.object({
  profile: LeadProfileSchema,
  agentId: z.string(),
  leadState: z.enum(["new", "warm", "cold"]),
});

const AGENTS: AgentProfile[] = z.array(AgentProfileSchema).parse(agentsJson);

// --- rate limiting -----------------------------------------------------------
// ponytail: in-memory, per-isolate limiter — resets when the isolate recycles
// and doesn't coordinate across colos. Good enough to keep a public demo from
// being farmed; upgrade to KV/Durable Objects if this ever matters.

const RATE_LIMIT_PER_HOUR = 15;
const GLOBAL_DAILY_CAP = 400;
const HOUR_MS = 60 * 60 * 1000;

const ipHits = new Map<string, { count: number; windowStart: number }>();
let dailyCount = 0;
let dailyKey = "";

function rateLimited(ip: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyKey) {
    dailyKey = today;
    dailyCount = 0;
  }
  if (dailyCount >= GLOBAL_DAILY_CAP) return true;

  const now = Date.now();
  const hit = ipHits.get(ip);
  if (!hit || now - hit.windowStart > HOUR_MS) {
    ipHits.set(ip, { count: 1, windowStart: now });
    dailyCount += 1;
    return false;
  }
  if (hit.count >= RATE_LIMIT_PER_HOUR) return true;
  hit.count += 1;
  dailyCount += 1;
  return false;
}

// --- helpers -----------------------------------------------------------------

type Env = Record<string, string | undefined>;

function llmConfig(env: Env): LlmConfig | null {
  // nodejs_compat mirrors secrets onto process.env, but fall back to the
  // binding object so local `wrangler dev --var` also works.
  const fromProcess = loadLlmConfigFromEnv();
  if (fromProcess) return fromProcess;
  if (!env.LLM_API_KEY) return null;
  return {
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL,
    model: env.LLM_MODEL ?? "gpt-4o-mini",
  };
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed =
    origin.startsWith("http://localhost:") || origin.endsWith(".workers.dev");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(request: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

// --- handlers ----------------------------------------------------------------

async function handleAnalyze(
  request: Request,
  config: LlmConfig
): Promise<Response> {
  const parsed = AnalyzeRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return json(request, 400, { error: parsed.error.issues[0]?.message });
  }

  const conversation: Conversation = {
    id: "live-demo",
    messages: parsed.data.messages,
  };

  // The real pipeline: deterministic → LLM extract → citation guardrail → merge.
  const { profile, violations } = await runPipeline(
    conversation,
    makeLlmExtractFn(config)
  );

  // Live chat has no message history timestamps — everything is "now".
  const nowIso = new Date().toISOString();
  const leadState = classifyLead({
    conversation,
    lastLeadMessageAt: nowIso,
    firstContactAt: nowIso,
    now: nowIso,
  });

  // Stateless API: replay the qualification reducer to a fixpoint so the UI
  // can show the full trajectory with reasons.
  const signals = { explicitStop: detectExplicitStop(conversation) };
  const trajectory: QualifyResult[] = [];
  let state: QualificationState = "new";
  for (let i = 0; i < 4; i++) {
    const step = qualify(state, profile, signals);
    trajectory.push(step);
    if (step.state === state) break;
    state = step.state;
  }

  return json(request, 200, {
    profile,
    guardrailViolations: violations,
    leadState,
    qualification: { state, trajectory },
  });
}

async function handleDraft(
  request: Request,
  config: LlmConfig
): Promise<Response> {
  const parsed = DraftRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return json(request, 400, { error: parsed.error.issues[0]?.message });
  }

  const agent = AGENTS.find((a) => a.id === parsed.data.agentId);
  if (!agent) {
    return json(request, 400, {
      error: `unknown agent "${parsed.data.agentId}"`,
    });
  }

  const write = makeLlmWriteFn(config);
  const draft = await write({
    profile: parsed.data.profile,
    leadState: parsed.data.leadState,
    agent,
  });
  // Same sandwich as everywhere else: LLM writes, rules verify.
  const verdict = verifyDraft(draft, parsed.data.profile, agent);

  return json(request, 200, {
    draft,
    verdict,
    agent: { id: agent.id, name: agent.name },
  });
}

// --- worker entry --------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/") || request.method !== "POST") {
      return json(request, 404, { error: "not found" });
    }

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (rateLimited(ip)) {
      return json(request, 429, {
        error: "demo rate limit reached — try again in a bit",
      });
    }

    const config = llmConfig(env);
    if (!config) {
      return json(request, 503, {
        error: "demo backend not configured (missing LLM_API_KEY secret)",
      });
    }

    try {
      if (url.pathname === "/api/analyze")
        return await handleAnalyze(request, config);
      if (url.pathname === "/api/draft")
        return await handleDraft(request, config);
      return json(request, 404, { error: "not found" });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "unexpected error";
      return json(request, 500, { error: message });
    }
  },
};
