import Anthropic from "@anthropic-ai/sdk";

export type AIMessageCreateParamsNonStreaming =
  Anthropic.MessageCreateParamsNonStreaming;

export interface AIResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
}

const DEFAULT_BASE_URL = "https://agentrouter.org/";

function normalizeAnthropicBaseUrl(value?: string | null): string {
  const raw = (value || DEFAULT_BASE_URL).trim();
  const noTrailingSlash = raw.replace(/\/+$/, "");
  return noTrailingSlash.replace(/\/v1$/, "");
}

function getClient(): Anthropic {
  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    process.env.AGENTROUTER_API_KEY ||
    process.env.AI_API_KEY ||
    null;
  const authToken =
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.AGENTROUTER_API_KEY ||
    process.env.AI_API_KEY ||
    apiKey ||
    null;

  return new Anthropic({
    apiKey,
    authToken,
    baseURL: normalizeAnthropicBaseUrl(
      process.env.ANTHROPIC_BASE_URL || process.env.AI_BASE_URL,
    ),
  });
}

function providerErrorMessage(err: unknown): string {
  const fallback = err instanceof Error ? err.message : "AI provider request failed";
  const providerError = (err as { error?: unknown })?.error;
  if (!providerError || typeof providerError !== "object") return fallback;

  const body = providerError as {
    error?: { message?: string };
    message?: string;
    type?: string;
  };
  const detail = body.error?.message || body.message || body.type;
  return detail ? `${fallback}: ${detail}` : fallback;
}

export async function callModel(
  params: AIMessageCreateParamsNonStreaming,
  options?: { signal?: AbortSignal },
): Promise<AIResult> {
  let response: Anthropic.Message;
  try {
    response = await getClient().messages.create(params, {
      signal: options?.signal,
    });
  } catch (err) {
    const normalized = new Error(providerErrorMessage(err)) as Error & {
      status?: number;
    };
    normalized.status = (err as { status?: number })?.status;
    throw normalized;
  }
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  const usage = response.usage as
    | (typeof response.usage & {
        server_tool_use?: { web_search_requests?: number };
      })
    | undefined;

  return {
    text,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    webSearchRequests: usage?.server_tool_use?.web_search_requests ?? 0,
  };
}
