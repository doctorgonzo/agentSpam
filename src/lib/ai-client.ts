import Anthropic from "@anthropic-ai/sdk";

export type AIMessageCreateParamsNonStreaming =
  Anthropic.MessageCreateParamsNonStreaming;

export interface AIResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
}

interface ChatCompletionLike {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
  };
  message?: string;
  type?: string;
}

interface UsageLike {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
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

function extractText(response: Anthropic.Message | ChatCompletionLike): string {
  const anthropicContent = (response as Anthropic.Message).content;
  if (Array.isArray(anthropicContent)) {
    return anthropicContent
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  }

  const chatContent = (response as ChatCompletionLike).choices?.[0]?.message
    ?.content;
  if (typeof chatContent === "string") return chatContent.trim();
  if (Array.isArray(chatContent)) {
    return chatContent
      .map((part) => (part.type === "text" ? part.text ?? "" : ""))
      .join("")
      .trim();
  }

  const providerError = response as ChatCompletionLike;
  const message =
    providerError.error?.message ||
    providerError.message ||
    providerError.error?.type ||
    providerError.type;
  if (message) {
    throw new Error(`AI provider request failed: ${message}`);
  }

  throw new Error("AI provider returned an unexpected response shape");
}

export async function callModel(
  params: AIMessageCreateParamsNonStreaming,
  options?: { signal?: AbortSignal },
): Promise<AIResult> {
  let response: Anthropic.Message | ChatCompletionLike;
  try {
    response = await getClient().messages.create(params, {
      signal: options?.signal,
    }) as Anthropic.Message | ChatCompletionLike;
  } catch (err) {
    const normalized = new Error(providerErrorMessage(err)) as Error & {
      status?: number;
    };
    normalized.status = (err as { status?: number })?.status;
    throw normalized;
  }
  const text = extractText(response);
  const usage = (response as { usage?: UsageLike }).usage;

  return {
    text,
    inputTokens: usage?.input_tokens ?? usage?.prompt_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? usage?.completion_tokens ?? 0,
    webSearchRequests: usage?.server_tool_use?.web_search_requests ?? 0,
  };
}
