import Anthropic from "@anthropic-ai/sdk";
import {
  AgentEvent,
  AgentNode,
  FileAttachment,
  MAX_AGENTS,
  MAX_DEPTH,
  MODEL_IDS,
  MODEL_LABELS,
  MODEL_PRICES,
  ModelTier,
  Specialty,
  WEB_SEARCH_COST,
} from "./types";

interface ClaudeResult {
  text: string;
  cost: number;
  outputTokens: number;
}

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
  specialty?: Specialty;
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
  return {
    model: MODEL_IDS.opus,
    max_tokens: 700,
    system: `You are THE BRAIN. You ONLY output JSON. You NEVER answer the user directly. Your job is splitting.

Split into 3-4 subtasks. Witty 2-4 word labels. Each self-contained.

Available "specialty" values (optional): "researcher", "calculator", "critic". Include 1 specialist (most runs benefit from a "critic"). Keep 2+ subtasks regular (no specialty) so the tree fans out.

OUTPUT FORMAT — nothing else:
{"subtasks":[{"label":"X","description":"Y","specialty":"critic"}]}`,
    messages: [{ role: "user", content: userPrompt }],
  };
}

function buildManagerPrompt(
  task: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.sonnet,
    max_tokens: 500,
    system: `You are MIDDLE MGMT. JSON only. No prose.

Split task into 2-3 self-contained subtasks with fun labels.

Optional specialty per subtask: "researcher" | "calculator" | "critic". Use sparingly.

JSON now:
{"subtasks":[{"label":"X","description":"Y","specialty":"researcher"}]}`,
    messages: [{ role: "user", content: `Task: ${task}` }],
  };
}

function buildWorkerPrompt(
  task: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 400,
    system: `You are a WORKER BEE. JSON only. ALWAYS split — never answer directly.

Break your task into 2-3 tiny self-contained subtasks. Each gets a 2-3 word funny label. Be aggressive about splitting — the dumb interns below will do the actual work.

JSON now:
{"subtasks":[{"label":"X","description":"Y"}]}`,
    messages: [{ role: "user", content: `Task: ${task}` }],
  };
}

function buildLeafPrompt(
  task: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 300,
    system:
      "You are THE INTERN — one brain cell, one job. Do it in 1-3 sentences. Be direct and a little cheeky.",
    messages: [{ role: "user", content: `Your one job: ${task}` }],
  };
}

function buildResearcherPrompt(
  task: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.sonnet,
    max_tokens: 800,
    system: `You are THE RESEARCHER — a specialist agent with web search. You hunt down hard facts.

Use web search (max 2 searches) to find SPECIFIC data: numbers, names, dates, sources. Then return your findings in 3-6 tight bullet points with sources cited inline. No fluff, no preamble, no "I'll search for...". Just the facts and where they came from.`,
    messages: [{ role: "user", content: `Research task: ${task}` }],
    tools: [{ type: "web_search_20250305" as const, name: "web_search", max_uses: 2 }],
  };
}

function buildCalculatorPrompt(
  task: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 500,
    system: `You are THE CALCULATOR — a specialist agent for numbers. You do math, percentages, comparisons, and projections with precision.

Show your math step by step using markdown. Always state your assumptions. End with a single-line "Answer:" followed by the result. Be concise but exact — wrong numbers are unforgivable.`,
    messages: [{ role: "user", content: `Calculation: ${task}` }],
  };
}

function buildCriticPrompt(
  task: string,
  siblingResults: { label: string; result: string }[],
): Anthropic.MessageCreateParamsNonStreaming {
  const siblingText = siblingResults
    .map((r) => `### ${r.label}\n${r.result}`)
    .join("\n\n");

  return {
    model: MODEL_IDS.sonnet,
    max_tokens: 600,
    system: `You are THE CRITIC — a specialist agent. You read your siblings' work and flag what's weak, unsupported, or wrong.

Be sharp. Be specific. Be brief.

Output a short markdown list of concerns or a confidence rating. If everything looks solid, say so in one line. If there are issues, name them concretely (e.g. "Sibling X claims Y but cites nothing"). No filler, no diplomacy.`,
    messages: [
      {
        role: "user",
        content: `Your review task: ${task}\n\nSibling outputs to review:\n\n${siblingText}`,
      },
    ],
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

  return {
    model: MODEL_IDS[tier],
    max_tokens: tier === "opus" ? 900 : 700,
    system: `You are ${MODEL_LABELS[tier]} in agentSpam. Synthesize sub-agent results into ONE final response.

Strict rules:
- Output markdown directly. No preamble, no "Here is..."
- Max 3-4 short paragraphs OR a tight bulleted answer
- Weave findings together, don't list them
- If a Critic flagged issues, address them briefly
- BE BRIEF. Quality over length.`,
    messages: [
      {
        role: "user",
        content: `Task: ${originalTask}\n\nResults:\n${resultsText}\n\nSynthesize, briefly:`,
      },
    ],
  };
}

function buildScoutPrompt(
  userPrompt: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.opus,
    max_tokens: 2000,
    system: `You are THE SCOUT — a recon agent with web search. The sub-agents downstream have NO internet access, so YOU are their only source of live data. They will rely entirely on what you return.

Look at the user's task:

- If it needs CURRENT data (news, prices, stocks, dates, real-world facts, statistics, anything time-sensitive), DO MULTIPLE SEARCHES to gather everything needed. Be thorough — search 4-6 times if the task is complex. Return a structured fact dump with concrete numbers, names, dates, and sources. Format as markdown bullets/sub-bullets, organized by topic.
- If it does NOT need live data (general questions, creative tasks, opinions, code), respond with exactly: NONE

Quality bar: if a sub-agent reads your output, they should have enough hard facts to answer specifically — never generically. Include numbers and proper names always.

Do not explain. Do not preamble. Facts or NONE.`,
    messages: [{ role: "user", content: userPrompt }],
    tools: [{ type: "web_search_20250305" as const, name: "web_search", max_uses: 6 }],
  };
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

  const userTask = userPrompt || `Analyze this ${file.name}`;

  content.push({
    type: "text",
    text: `Document attached: ${file.name}\n\nUser request: ${userTask}\n\nIMPORTANT: Sub-agents CANNOT see this document. You MUST extract the key content from it and embed it directly in each subtask description so they have something to work with. Quote names, numbers, sections — make each subtask self-sufficient.`,
  });

  return {
    model: MODEL_IDS.opus,
    max_tokens: 1500,
    system: `You are THE BRAIN. You ONLY output JSON. Never answer directly.

You're analyzing a document. Read it carefully, then split the analysis into 3-4 subtasks. Each subtask description MUST include the actual content from the document the sub-agent needs — names, quotes, numbers, full sections. Sub-agents have no access to the file.

Witty 2-4 word labels. Include 1 "critic" specialty. Keep 2+ subtasks regular so the tree fans out.

OUTPUT FORMAT — nothing else:
{"subtasks":[{"label":"X","description":"Y with embedded content from doc","specialty":"critic"}]}`,
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

const AGENT_TIMEOUT_MS = 45000;

async function callClaude(
  params: Anthropic.MessageCreateParamsNonStreaming,
  signal?: AbortSignal,
): Promise<ClaudeResult> {
  if (signal?.aborted) throw new Error("aborted");

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), AGENT_TIMEOUT_MS);

  const cleanup = () => clearTimeout(timer);
  const onUpstreamAbort = () => timeoutController.abort();
  signal?.addEventListener("abort", onUpstreamAbort);

  let response;
  try {
    response = await anthropic.messages.create(params, {
      signal: timeoutController.signal,
    });
  } catch (err) {
    cleanup();
    signal?.removeEventListener("abort", onUpstreamAbort);
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new Error("agent timed out (45s)");
    }
    throw err;
  }
  cleanup();
  signal?.removeEventListener("abort", onUpstreamAbort);
  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

  const price = MODEL_PRICES[params.model] || { input: 0, output: 0 };
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  const searches =
    (response.usage as { server_tool_use?: { web_search_requests?: number } })
      ?.server_tool_use?.web_search_requests || 0;
  const cost =
    inputTokens * price.input +
    outputTokens * price.output +
    searches * WEB_SEARCH_COST;

  return { text, cost, outputTokens };
}

export async function runAgentTree(
  prompt: string,
  file: FileAttachment | undefined,
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  agentCounter = 0;

  let totalCost = 0;
  let totalOutputTokens = 0;

  function trackCost(result: ClaudeResult) {
    totalCost += result.cost;
    totalOutputTokens += result.outputTokens;
    // Rough heuristic: ~80 output tokens/min of equivalent human work.
    // Plus a baseline 1.5 min per agent for context-switching/thought.
    const humanMinutes = totalOutputTokens / 80 + agentCounter * 1.5;
    emit({
      type: "cost_update",
      totalCost,
      humanMinutes: Math.round(humanMinutes),
    });
  }

  async function call(
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<string> {
    const result = await callClaude(params, signal);
    trackCost(result);
    return result.text;
  }

  async function runScoutLocal(p: string): Promise<string | null> {
    try {
      const text = await call(buildScoutPrompt(p));
      const trimmed = text.trim();
      if (!trimmed || trimmed.toUpperCase().includes("NONE")) return null;
      return trimmed;
    } catch {
      return null;
    }
  }

  let enrichedPrompt = prompt;
  if (!file && prompt.trim()) {
    emit({ type: "scout_searching" });
    const findings = await runScoutLocal(prompt);
    if (findings) {
      // Cap the scout dump injected into Brain's prompt — keeps Brain fast.
      // Full findings still go to sub-agents that need them.
      const truncated = findings.length > 1200 ? findings.slice(0, 1200) + "..." : findings;
      enrichedPrompt = `${prompt}\n\n[Scout facts]: ${truncated}`;
      emit({ type: "scout_complete", findings });
    } else {
      emit({ type: "scout_complete", findings: null });
    }
  }

  async function spawnAgent(
    task: string,
    label: string,
    depth: number,
    parentId: string | null,
    specialty?: Specialty,
    criticContext?: { label: string; result: string }[],
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
      specialty,
    };

    emit({ type: "agent_spawned", agent: node });
    emit({ type: "agent_thinking", id });

    try {
      let params: Anthropic.MessageCreateParamsNonStreaming;

      if (specialty === "researcher") {
        params = buildResearcherPrompt(task);
      } else if (specialty === "calculator") {
        params = buildCalculatorPrompt(task);
      } else if (specialty === "critic") {
        params = buildCriticPrompt(task, criticContext || []);
      } else if (depth === 0 && file) {
        params = buildRootMultimodalPrompt(task, file);
      } else if (depth === 0) {
        params = buildRootPrompt(task);
      } else if (depth >= MAX_DEPTH) {
        params = buildLeafPrompt(task);
      } else if (depth === 1) {
        params = buildManagerPrompt(task);
      } else {
        params = buildWorkerPrompt(task);
      }

      let responseText = await call(params);
      let parsed = parseAgentResponse(responseText);

      // Specialists always answer directly — they never decompose
      if (specialty) {
        const answer = parsed.type === "answer" ? parsed.answer : responseText;
        emit({ type: "agent_complete", id, result: answer });
        return { label, result: answer };
      }

      // The Brain MUST decompose. If it returned an answer, retry once with a
      // more forceful prompt that uses the previous answer as context.
      if (depth === 0 && parsed.type !== "subtasks") {
        const retryParams: Anthropic.MessageCreateParamsNonStreaming = {
          model: MODEL_IDS.opus,
          max_tokens: 700,
          system: `You are THE BRAIN. Your previous output was wrong — you answered directly when you MUST decompose. Try again. ONLY output JSON. Split the user's request into 3-4 subtasks. Include 1 "critic" specialty.`,
          messages: [
            { role: "user", content: task },
            { role: "assistant", content: responseText.slice(0, 400) },
            {
              role: "user",
              content: `That was wrong. Output ONLY this JSON shape, nothing else:\n{"subtasks":[{"label":"X","description":"Y","specialty":"critic"}]}`,
            },
          ],
        };
        responseText = await call(retryParams);
        parsed = parseAgentResponse(responseText);
      }

      if (parsed.type === "subtasks" && depth < MAX_DEPTH) {
        if (signal?.aborted) {
          emit({ type: "agent_complete", id, result: "[stopped]" });
          return { label, result: "[stopped]" };
        }

        // Brain-level safety net: enforce shape of the tree.
        // - At least 2 regular subtasks (so the tree fans out).
        // - At least 1 specialist (so the run has flavor).
        if (depth === 0) {
          // Demote extra non-critic specialists if regulars < 2
          let specialistCount = parsed.subtasks.filter(
            (s) => s.specialty && s.specialty !== "critic",
          ).length;
          for (const sub of parsed.subtasks) {
            const regularCount = parsed.subtasks.filter(
              (s) => !s.specialty,
            ).length;
            if (regularCount >= 2) break;
            if (sub.specialty && sub.specialty !== "critic" && specialistCount > 1) {
              sub.specialty = undefined;
              specialistCount--;
            }
          }
          // Ensure at least 1 specialist — promote last regular subtask to critic
          const hasSpecialist = parsed.subtasks.some((s) => s.specialty);
          if (!hasSpecialist && parsed.subtasks.length >= 3) {
            const lastRegular = [...parsed.subtasks].reverse().find((s) => !s.specialty);
            if (lastRegular) lastRegular.specialty = "critic";
          }
        }

        const critics = parsed.subtasks.filter((s) => s.specialty === "critic");
        const nonCritics = parsed.subtasks.filter((s) => s.specialty !== "critic");

        const nonCriticResults = await Promise.all(
          nonCritics.map((sub) =>
            spawnAgent(sub.description, sub.label, depth + 1, id, sub.specialty),
          ),
        );

        if (signal?.aborted) {
          const partial = nonCriticResults.map((r) => r.result).join("\n\n");
          emit({ type: "agent_complete", id, result: partial || "[stopped]" });
          return { label, result: partial || "[stopped]" };
        }

        const criticResults = critics.length
          ? await Promise.all(
              critics.map((c) =>
                spawnAgent(c.description, c.label, depth + 1, id, "critic", nonCriticResults),
              ),
            )
          : [];

        const childResults = [...nonCriticResults, ...criticResults];

        if (signal?.aborted) {
          const partial = childResults.map((r) => r.result).join("\n\n");
          emit({ type: "agent_complete", id, result: partial || "[stopped]" });
          return { label, result: partial || "[stopped]" };
        }

        const synthesisParams = buildSynthesisPrompt(task, childResults, tier);
        const synthesis = await call(synthesisParams);

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

  const rootResult = await spawnAgent(enrichedPrompt, "The Brain", 0, null);

  if (!signal?.aborted) {
    emit({ type: "final_result", result: rootResult.result });
  }
  emit({ type: "done" });
}
