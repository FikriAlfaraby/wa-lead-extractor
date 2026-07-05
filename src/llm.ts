import OpenAI from "openai";

/**
 * Thin wrapper around any OpenAI-compatible chat completions endpoint.
 * Deliberately not a framework: one function, one responsibility. Swapping
 * providers means pointing LLM_BASE_URL somewhere else — no code change.
 */

export interface LlmConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
}

export function loadLlmConfigFromEnv(): LlmConfig | null {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseURL: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
  };
}

export async function callLlmJson(
  config: LlmConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<unknown> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  const completion = await client.chat.completions.create({
    model: config.model,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned an empty response");
  }

  // Defensive parse: some OpenAI-compatible gateways ignore
  // response_format and wrap JSON in prose or code fences.
  return parseJsonDefensively(content);
}

export function parseJsonDefensively(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      return JSON.parse(fenced[1]);
    }
    const braceStart = content.indexOf("{");
    const braceEnd = content.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
      return JSON.parse(content.slice(braceStart, braceEnd + 1));
    }
    throw new Error("Could not parse LLM response as JSON");
  }
}
