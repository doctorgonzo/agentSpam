import Anthropic from "@anthropic-ai/sdk";
import {
  AgentEvent,
  AgentNode,
  FileAttachment,
  MAX_AGENTS,
  MAX_DEPTH,
  MODEL_IDS,
  MODEL_LABELS,
  ModelTier,
} from "./types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let agentCounter = 0;

function getTier(depth: number): ModelTier {
  if (depth === 0) return "opus";
  if (depth === 1) return "sonnet";
  return "haiku";
}

function makeId(): string {
  return `agent-${++agentCounter}`;
}

interface Subtask {
  label: string;
  description: string;
}

interface DecomposeResult {
  type: "subtasks";
  subtasks: Subtask[];
}

interface DirectResult {
  type: "answer";
  answer: string;
}

type AgentResponse = DecomposeResult | DirectResult;

function buildRootPrompt(
  userPrompt: string,
): Anthropic.MessageCreateParamsNonStreaming {
  const systemPrompt = `You are THE BRAIN — the most intelligent agent in a recursive decomposition system called agentSpam. You analyze complex tasks and break them into pieces that dumber agents can handle.

IMPORTANT: You must ALWAYS decompose. Never answer directly. Your entire job is delegation.

Break the task into 3-5 independent subtasks. For each subtask:
- Make it self-contained (sub-agents can't see the original input)
- Include enough context that a dumber agent can act independently
- Give it a funny, creative label (2-4 words)
- Think about DIFFERENT ANGLES of the problem — don't just split sequentially

Respond ONLY with valid JSON:
{
  "subtasks": [
    { "label": "Witty Agent Name", "description": "Detailed, self-contained description of the task with all needed context" }
  ]
}`;

  return {
    model: MODEL_IDS.opus,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };
}

function buildMidPrompt(
  task: string,
  depth: number,
  tier: ModelTier,
): Anthropic.MessageCreateParamsNonStreaming {
  const isHaiku = tier === "haiku";
  const role = isHaiku
    ? "WORKER BEE — a small, fast, ultra-specialized agent"
    : "MID-LEVEL AGENT — smart enough to know what you don't know";
  const maxSubs = isHaiku ? 3 : 4;

  const systemPrompt = `You are a ${role} in a recursive AI system called agentSpam.

You received a task. First, DECIDE what you're best at — what's your specialty? Then either:

1. If the task has multiple distinct parts, decompose into 2-${maxSubs} subtasks for ${isHaiku ? "even tinier, more specialized" : "dumber"} agents. Each subtask must be self-contained. Give each a fun label.
   Respond: { "subtasks": [{ "label": "Fun Name", "description": "detailed task" }] }

2. ONLY if the task is truly atomic (one single, simple thing), do it yourself.
   Respond: { "answer": "your response" }

You are at depth ${depth} of ${MAX_DEPTH}. ${depth < MAX_DEPTH - 1 ? (isHaiku ? "Spawn more workers — delegate the tiny stuff!" : "Prefer decomposing — delegate aggressively!") : "You're near the bottom. Answer directly unless you really need to split."}

Respond ONLY with valid JSON.`;

  return {
    model: MODEL_IDS[tier],
    max_tokens: isHaiku ? 768 : 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: `Your task: ${task}` }],
  };
}

function buildLeafPrompt(
  task: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 512,
    system:
      "You are THE INTERN — the simplest agent in the system. You have exactly ONE brain cell and ONE job. Do it in 1-4 sentences. Be direct, specific, and a little cheeky. No JSON, no formatting, just your raw answer. Own your one job like your life depends on it.",
    messages: [{ role: "user", content: `Your one job: ${task}` }],
  };
}

function buildSynthesisPrompt(
  originalTask: string,
  childResults: { label: string; result: string }[],
  tier: ModelTier,
): Anthropic.MessageCreateParamsNonStreaming {
  const resultsText = childResults
    .map((r) => `[${r.label}]: ${r.result}`)
    .join("\n\n");

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: MODEL_IDS[tier],
    max_tokens: 2048,
    system: `You are a ${MODEL_LABELS[tier]} agent in agentSpam. Your dumber sub-agents have completed their pieces. Your job: synthesize their results into one coherent, well-structured response using markdown. Be thorough but concise — weave their contributions together, don't just list them. The final output should feel like it came from one mind, not a committee.`,
    messages: [
      {
        role: "user",
        content: `Original task: ${originalTask}\n\nSub-agent results:\n${resultsText}\n\nSynthesize into a polished final answer:`,
      },
    ],
  };

  if (tier === "opus") {
    params.thinking = { type: "enabled", budget_tokens: 5000 };
    params.max_tokens = 8000;
  }

  return params;
}

function buildRootMultimodalPrompt(
  userPrompt: string,
  file: FileAttachment,
): Anthropic.MessageCreateParamsNonStreaming {
  const content: Anthropic.MessageCreateParamsNonStreaming["messages"][0]["content"] =
    [];

  if (file.mediaType.startsWith("image/")) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: file.mediaType as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp",
        data: file.data,
      },
    });
  } else if (file.mediaType === "application/pdf") {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: file.data,
      },
    });
  }

  content.push({
    type: "text",
    text:
      userPrompt ||
      `Analyze this ${file.name} and break the analysis into subtasks.`,
  });

  return {
    model: MODEL_IDS.opus,
    max_tokens: 1500,
    system: buildRootPrompt("").system as string,
    messages: [{ role: "user", content }],
  };
}

function parseAgentResponse(text: string): AgentResponse {
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.subtasks && Array.isArray(parsed.subtasks)) {
      return { type: "subtasks", subtasks: parsed.subtasks };
    }
    if (parsed.answer) {
      return { type: "answer", answer: parsed.answer };
    }
  } catch {
    // not JSON — treat as direct answer
  }

  return { type: "answer", answer: text };
}

async function callClaude(
  params: Anthropic.MessageCreateParamsNonStreaming,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new Error("aborted");
  const response = await anthropic.messages.create(params, { signal });
  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "";
}

export async function runAgentTree(
  prompt: string,
  file: FileAttachment | undefined,
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  agentCounter = 0;

  async function spawnAgent(
    task: string,
    label: string,
    depth: number,
    parentId: string | null,
  ): Promise<{ label: string; result: string }> {
    if (signal?.aborted) {
      return { label, result: "[stopped]" };
    }

    if (agentCounter >= MAX_AGENTS) {
      return { label, result: "[max agents reached]" };
    }

    const id = makeId();
    const tier = getTier(depth);

    const node: AgentNode = {
      id,
      parentId,
      depth,
      model: tier,
      task,
      label,
      status: "spawning",
    };

    emit({ type: "agent_spawned", agent: node });

    await sleep(200 + Math.random() * 200);

    if (signal?.aborted) {
      emit({ type: "agent_error", id, error: "stopped" });
      return { label, result: "[stopped]" };
    }

    emit({ type: "agent_thinking", id });

    try {
      let params: Anthropic.MessageCreateParamsNonStreaming;

      if (depth === 0 && file) {
        params = buildRootMultimodalPrompt(task, file);
      } else if (depth === 0) {
        params = buildRootPrompt(task);
      } else if (depth >= MAX_DEPTH) {
        params = buildLeafPrompt(task);
      } else {
        params = buildMidPrompt(task, depth, tier);
      }

      const responseText = await callClaude(params, signal);
      const parsed = parseAgentResponse(responseText);

      if (parsed.type === "subtasks" && depth < MAX_DEPTH) {
        if (signal?.aborted) {
          emit({ type: "agent_complete", id, result: "[stopped before spawning children]" });
          return { label, result: "[stopped]" };
        }

        const childResults = await Promise.all(
          parsed.subtasks.map((sub) =>
            spawnAgent(sub.description, sub.label, depth + 1, id),
          ),
        );

        if (signal?.aborted) {
          const partial = childResults.map((r) => r.result).join("\n\n");
          emit({ type: "agent_complete", id, result: partial || "[stopped]" });
          return { label, result: partial || "[stopped]" };
        }

        const synthesisParams = buildSynthesisPrompt(task, childResults, tier);
        const synthesis = await callClaude(synthesisParams, signal);

        emit({ type: "agent_complete", id, result: synthesis });
        return { label, result: synthesis };
      } else {
        const answer =
          parsed.type === "answer" ? parsed.answer : responseText;
        emit({ type: "agent_complete", id, result: answer });
        return { label, result: answer };
      }
    } catch (err) {
      if (signal?.aborted) {
        emit({ type: "agent_error", id, error: "stopped" });
        return { label, result: "[stopped]" };
      }
      const msg = err instanceof Error ? err.message : "Unknown error";
      emit({ type: "agent_error", id, error: msg });
      return { label, result: `[error: ${msg}]` };
    }
  }

  const rootResult = await spawnAgent(prompt, "The Brain", 0, null);

  if (!signal?.aborted) {
    emit({ type: "final_result", result: rootResult.result });
  }
  emit({ type: "done" });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
