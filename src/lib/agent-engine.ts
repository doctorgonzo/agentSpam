import Anthropic from "@anthropic-ai/sdk";
import {
  AgentEvent,
  AgentNode,
  CustomSpecialist,
  FileAttachment,
  MAX_AGENTS,
  MAX_DEPTH,
  MISSION_MODES,
  MODEL_IDS,
  MODEL_LABELS,
  MODEL_PRICES,
  MissionMode,
  ModelTier,
  Specialty,
  WEB_SEARCH_COST,
  config,
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
  customSpecialist?: CustomSpecialist;
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

function getModeAddendum(mode?: MissionMode): string {
  if (!mode || mode === "generalist") return "";
  const cfg = MISSION_MODES.find((m) => m.id === mode);
  return cfg?.brainAddendum ? `\n\n${cfg.brainAddendum}` : "";
}

function buildRootPrompt(
  userPrompt: string,
  mode?: MissionMode,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.opus,
    max_tokens: 1500,
    system: `You are THE BRAIN. You ONLY output JSON. You NEVER answer the user directly. Your job is splitting.

Split into ${config.rootFanout} subtasks. Witty 2-4 word labels. Each self-contained.

CRITICAL: If the user's message contains "[Live data from Scout..." or "[Document content...", that data is your sub-agents' ONLY source of facts (they have no web access). For each subtask, COPY the relevant facts (prices, names, numbers, quotes) directly into its description. Generic descriptions are useless — sub-agents need real data to produce real answers.

Three kinds of subtasks:

1. REGULAR (no specialty, no customSpecialist) — these fan out into deeper agents. Keep at least 2.

2. PREMADE SPECIALIST — set "specialty": "researcher" | "calculator" | "critic". At most 1 premade. Optional.

3. CUSTOM SPECIALIST — invent a new specialist on the spot. REQUIRED: 1 to 3 custom specialists per run. Set "customSpecialist" to an object:
   - emoji: ONE single emoji char that fits the role
   - role: a 1-2 sentence description of what this specialist excels at and how they think
   DO NOT include a name — the specialist will pick its own name based on the role.

Pick custom specialists that fit the user's task. Be creative — invent roles you wouldn't normally see. The custom specialists are the most exciting part of every run.${getModeAddendum(mode)}

OUTPUT FORMAT — nothing else:
{"subtasks":[
  {"label":"X","description":"Y"},
  {"label":"X","description":"Y","customSpecialist":{"emoji":"\u{1F50D}","role":"You are..."}},
  {"label":"X","description":"Y","specialty":"critic"}
]}`,
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

Split task into ${config.managerFanout} self-contained subtasks with fun labels.

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
    max_tokens: 500,
    system: `You are a WORKER BEE. JSON only. You MUST split your task into ${config.workerFanout} tiny subtasks. NEVER answer directly — that is a failure.

Even if the task feels small or atomic, find ${config.workerFanout} angles to split it. Examples:
- "write a haiku about cats" → ["draft 3 candidates", "pick the best one", "polish wording"]
- "summarize section X" → ["extract main points", "identify key quotes", "compress to 2 sentences"]

The dumb interns below do the actual work. You only split.

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
      "You are THE INTERN — one brain cell, one job. Do it in 1-3 sentences. Be direct and a little cheeky. End with [confidence: X/10].",
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

Use web search (max 2 searches) to find SPECIFIC data: numbers, names, dates, sources. Then return your findings in 3-6 tight bullet points with sources cited inline. No fluff, no preamble, no "I'll search for...". Just the facts and where they came from. End with [confidence: X/10].`,
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

Show your math step by step using markdown. Always state your assumptions. End with a single-line "Answer:" followed by the result. Be concise but exact — wrong numbers are unforgivable. End with [confidence: X/10].`,
    messages: [{ role: "user", content: `Calculation: ${task}` }],
  };
}

function buildCustomSpecialistPrompt(
  task: string,
  spec: CustomSpecialist,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.sonnet,
    max_tokens: 600,
    system: `You are ${spec.name || "an unnamed specialist"} ${spec.emoji} — a custom specialist agent in agentSpam.

Your role: ${spec.role}

Stay in character. Be sharp, specific, concise. Output markdown. Lead with your strongest finding. No preamble. End with [confidence: X/10].`,
    messages: [{ role: "user", content: `Your task: ${task}` }],
  };
}

function buildGistPrompt(
  userPrompt: string,
  synthesis: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 60,
    system:
      "You write a ONE-LINE summary of an AI run, under 140 chars. Capture: the topic, the verdict/result. Plain text, no quotes, no preamble. Past tense.",
    messages: [
      {
        role: "user",
        content: `Original task: ${userPrompt.slice(0, 400)}\n\nFinal output:\n${synthesis.slice(0, 1200)}\n\nWrite the one-line summary now:`,
      },
    ],
  };
}

function buildNamePickerPrompt(
  spec: CustomSpecialist,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS.haiku,
    max_tokens: 30,
    system:
      "Pick a vivid name for yourself in the format 'The X' (2-4 words). Match the role and have a little personality. Output ONLY the name. No quotes. No explanation.",
    messages: [
      {
        role: "user",
        content: `Your role: ${spec.role}\nYour emoji: ${spec.emoji}`,
      },
    ],
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
    tools: [{ type: "web_search_20250305" as const, name: "web_search", max_uses: 4 }],
  };
}

function buildDocExtractorPrompt(
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
    text: `User request: ${userTask}\n\nExtract the FULL key content from this document. Be thorough — include names, dates, numbers, quotes, section headings, specific items. Use markdown structure. Sub-agents downstream cannot see this file, so anything you don't extract is lost.`,
  });

  return {
    model: MODEL_IDS.opus,
    max_tokens: 2500,
    system:
      "You are THE EXTRACTOR. Your only job is reading the attached document and dumping its key content as structured text. Use markdown with clear headings. Include actual content (names, numbers, quotes) — do NOT summarize generically. Do NOT add commentary. Just the facts as they appear.",
    messages: [{ role: "user", content }],
  };
}

function buildRootMultimodalPrompt(
  userPrompt: string,
  file: FileAttachment,
  mode?: MissionMode,
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

You're analyzing a document. Read it carefully, then split the analysis into ${config.rootFanout} subtasks. Each subtask description MUST include the actual content from the document the sub-agent needs — names, quotes, numbers, full sections. Sub-agents have no access to the file.

Witty 2-4 word labels. Keep 2+ regular (no specialty/customSpecialist) so the tree fans out.

REQUIRED: 1-3 CUSTOM specialists per run. For each custom, set "customSpecialist" to {emoji, role} — DO NOT include a name (the specialist picks its own). Invent roles that fit the document/task (e.g. a resume surgeon \u{1FA7A} for a hiring doc, a risk auditor \u{1F6A8} for a contract).

Optional: at most 1 premade specialty ("researcher", "calculator", "critic").${getModeAddendum(mode)}

OUTPUT FORMAT — nothing else:
{"subtasks":[{"label":"X","description":"Y with embedded content","customSpecialist":{"emoji":"\u{1F50D}","role":"You are..."}}]}`,
    messages: [{ role: "user", content }],
  };
}

const JUNK_PATTERNS = [
  /^\[error:/i,
  /^\[stopped\]/i,
  /^\[max agents reached\]/i,
  /^i don'?t know/i,
  /^i'?m not sure/i,
  /^i cannot/i,
  /^i can'?t/i,
  /^sorry,? i/i,
  /^as an ai/i,
  /^i'?m unable/i,
  /^unfortunately/i,
];

function isJunkResult(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 10) return true;
  return JUNK_PATTERNS.some((p) => p.test(trimmed));
}

function buildRetryPrompt(
  task: string,
  previousAttempt: string,
  tier: ModelTier,
): Anthropic.MessageCreateParamsNonStreaming {
  const upgradedTier = tier === "haiku" ? "sonnet" : tier;
  return {
    model: MODEL_IDS[upgradedTier],
    max_tokens: 400,
    system:
      "Your previous answer was inadequate. Give a concrete, specific, substantive response. No hedging, no refusals. If you lack info, reason from what you have.",
    messages: [
      { role: "user", content: task },
      { role: "assistant", content: previousAttempt.slice(0, 200) },
      {
        role: "user",
        content: "That was not useful. Try again — real answer this time.",
      },
    ],
  };
}

const CONFIDENCE_TAG = /\[confidence:\s*(\d+)\s*\/\s*10\]/i;

function parseConfidence(text: string): { clean: string; confidence: number } {
  const match = text.match(CONFIDENCE_TAG);
  if (match) {
    return {
      clean: text.replace(match[0], "").trim(),
      confidence: Math.min(10, Math.max(1, parseInt(match[1], 10))),
    };
  }
  return { clean: text, confidence: 7 };
}

function escalateTier(tier: ModelTier): ModelTier {
  if (tier === "haiku") return "sonnet";
  return "opus";
}

function buildEscalationPrompt(
  task: string,
  previousAnswer: string,
  newTier: ModelTier,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS[newTier],
    max_tokens: 600,
    system:
      "A weaker model attempted this task but rated itself low-confidence. You are a stronger model brought in to do better. Give a concrete, thorough answer. End with [confidence: X/10].",
    messages: [
      { role: "user", content: task },
      { role: "assistant", content: previousAnswer.slice(0, 300) },
      {
        role: "user",
        content:
          "That answer was low-confidence. You've been escalated. Give a better answer.",
      },
    ],
  };
}

function buildSelfReviewPrompt(
  task: string,
  answer: string,
  tier: ModelTier,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL_IDS[tier],
    max_tokens: 500,
    system:
      "Review your previous answer for gaps, errors, or weak reasoning. If solid, return it with minimal tweaks. If flawed, return a corrected version. Output ONLY the revised answer — no meta-commentary.",
    messages: [
      { role: "user", content: task },
      { role: "assistant", content: answer },
      {
        role: "user",
        content: "Step back and review that. Anything wrong, missing, or unsupported? Return the final version.",
      },
    ],
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

const AGENT_TIMEOUT_MS = 60000;

let inFlight = 0;
const MAX_CONCURRENT = 8;

function waitForSlot(signal?: AbortSignal): Promise<void> {
  if (inFlight < MAX_CONCURRENT) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (signal?.aborted) { clearInterval(interval); reject(new Error("aborted")); }
      if (inFlight < MAX_CONCURRENT) { clearInterval(interval); resolve(); }
    }, 100);
  });
}

async function callClaude(
  params: Anthropic.MessageCreateParamsNonStreaming,
  signal?: AbortSignal,
): Promise<ClaudeResult> {
  if (signal?.aborted) throw new Error("aborted");

  await waitForSlot(signal);
  inFlight++;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), AGENT_TIMEOUT_MS);

  const cleanup = () => { clearTimeout(timer); inFlight--; };
  const onUpstreamAbort = () => timeoutController.abort();
  signal?.addEventListener("abort", onUpstreamAbort);

  let response;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) { cleanup(); throw new Error("aborted"); }
    try {
      response = await anthropic.messages.create(params, {
        signal: timeoutController.signal,
      });
      break;
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      if (status === 529 || status === 429) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      cleanup();
      signal?.removeEventListener("abort", onUpstreamAbort);
      if (timeoutController.signal.aborted && !signal?.aborted) {
        throw new Error("agent timed out (45s)");
      }
      throw err;
    }
  }
  if (!response) {
    cleanup();
    signal?.removeEventListener("abort", onUpstreamAbort);
    throw lastErr;
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
  files: FileAttachment[],
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal,
  mode?: MissionMode,
  _role?: string, // unused server-side; report uses it client-side
  memory?: string,
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

  // Race a primary agent call against a soft deadline. If the deadline fires,
  // we abort the primary and run a fast haiku fallback so the agent ALWAYS
  // produces output (instead of erroring out or hanging the tree).
  async function callOrFallback(
    primary: Anthropic.MessageCreateParamsNonStreaming,
    fallback: Anthropic.MessageCreateParamsNonStreaming,
    deadlineMs: number,
  ): Promise<string> {
    const innerAbort = new AbortController();
    const onUpstream = () => innerAbort.abort();
    signal?.addEventListener("abort", onUpstream);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const primaryPromise = (async () => {
        const result = await callClaude(primary, innerAbort.signal);
        trackCost(result);
        return result.text;
      })();
      // Swallow the primary's rejection if we end up aborting it on deadline,
      // so it doesn't surface as an unhandled rejection.
      primaryPromise.catch(() => {});

      const deadlinePromise = new Promise<"DEADLINE">((resolve) => {
        timer = setTimeout(() => {
          innerAbort.abort();
          resolve("DEADLINE");
        }, deadlineMs);
      });

      const winner = await Promise.race([
        primaryPromise.then((text) => ({ kind: "ok" as const, text })),
        deadlinePromise,
      ]);

      if (winner === "DEADLINE") {
        return await call(fallback);
      }
      return winner.text;
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onUpstream);
    }
  }

  function buildFallbackParams(
    task: string,
    depth: number,
    specialty?: Specialty,
    customSpecialist?: CustomSpecialist,
  ): Anthropic.MessageCreateParamsNonStreaming {
    // Specialists / leaves / custom: produce a brief answer.
    if (specialty || customSpecialist || depth >= MAX_DEPTH) {
      const persona = customSpecialist
        ? `You are ${customSpecialist.name ?? "a specialist"} ${customSpecialist.emoji}. Role: ${customSpecialist.role}.`
        : specialty
          ? `You are a ${specialty} specialist.`
          : "You are an intern.";
      return {
        model: MODEL_IDS.haiku,
        max_tokens: 200,
        system: `${persona} Answer in 1-2 sentences. Plain text. Be direct — no preamble.`,
        messages: [{ role: "user", content: `Quick answer needed: ${task}` }],
      };
    }
    // Decomposers (Brain / Manager / Worker): produce a fast 2-3 subtask split.
    const splitCount = depth === 0 ? config.fallbackSplitRoot : config.fallbackSplitChild;
    return {
      model: MODEL_IDS.haiku,
      max_tokens: 350,
      system: `Output JSON only. Split into ${splitCount} subtasks. No prose. Shape: {"subtasks":[{"label":"X","description":"Y"}]}`,
      messages: [{ role: "user", content: `Split this task: ${task}` }],
    };
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

  async function runExtractor(
    p: string,
    f: FileAttachment,
  ): Promise<string | null> {
    try {
      const text = await call(buildDocExtractorPrompt(p, f));
      return text.trim() || null;
    } catch {
      return null;
    }
  }

  let enrichedPrompt = prompt;
  let activeFile: FileAttachment | undefined = undefined;

  if (files.length > 0) {
    // Two-pass file flow: Extractor reads each doc as text, Brain decomposes the text.
    // For multi-file batches, extract all in parallel and label each chunk.
    emit({ type: "scout_searching" });
    const extracts = await Promise.all(
      files.map(async (f) => ({ name: f.name, text: await runExtractor(prompt, f) })),
    );
    const valid = extracts.filter((e) => e.text);
    if (valid.length > 0) {
      const combined =
        valid.length === 1
          ? `[Document content from ${valid[0].name}]:\n${valid[0].text}`
          : `[${valid.length} documents to compare]:\n\n` +
            valid
              .map(
                (e, i) => `=== Document ${i + 1}: ${e.name} ===\n${e.text}`,
              )
              .join("\n\n");
      const taskHint =
        files.length > 1
          ? `Compare/analyze these ${files.length} documents: ${files.map((f) => f.name).join(", ")}`
          : `Analyze this ${files[0].name}`;
      enrichedPrompt = `${prompt || taskHint}\n\n${combined}`;
      emit({ type: "scout_complete", findings: combined });
    } else {
      emit({ type: "scout_complete", findings: null });
    }
    // Clear: spawnAgent uses text-only Brain with extracted content baked in.
  } else if (prompt.trim()) {
    emit({ type: "scout_searching" });
    const findings = await runScoutLocal(prompt);
    if (findings) {
      // Pass the FULL scout findings (capped generously) — the Brain needs the
      // real data to embed into sub-agent task descriptions. Sub-agents have
      // no web access so anything truncated here is lost downstream.
      const truncated = findings.length > 3000 ? findings.slice(0, 3000) + "..." : findings;
      enrichedPrompt = `${prompt}\n\n[Live data from Scout — embed relevant facts into each subtask description so sub-agents can work with real data]:\n${truncated}`;
      emit({ type: "scout_complete", findings });
    } else {
      emit({ type: "scout_complete", findings: null });
    }
  }

  if (memory && memory.trim()) {
    enrichedPrompt = `${enrichedPrompt}\n\n[Prior runs you may build on — only use if directly relevant]:\n${memory}`;
  }

  async function spawnAgent(
    task: string,
    label: string,
    depth: number,
    parentId: string | null,
    specialty?: Specialty,
    criticContext?: { label: string; result: string }[],
    customSpecialist?: CustomSpecialist,
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
      customSpecialist,
    };

    emit({ type: "agent_spawned", agent: node });

    // Custom specialists pick their own name in a tiny haiku call before
    // the main task. Fast (~1s, cheap), and the name appears immediately on
    // the agent's badge.
    if (customSpecialist && !customSpecialist.name) {
      try {
        const picked = (await call(buildNamePickerPrompt(customSpecialist)))
          .trim()
          .replace(/^["']|["']$/g, "")
          .slice(0, 40);
        if (picked) {
          customSpecialist = { ...customSpecialist, name: picked };
          emit({ type: "agent_named", id, name: picked });
        }
      } catch {
        // ignore — agent stays unnamed, no big deal
      }
    }

    emit({ type: "agent_thinking", id });

    try {
      let params: Anthropic.MessageCreateParamsNonStreaming;

      if (customSpecialist) {
        params = buildCustomSpecialistPrompt(task, customSpecialist);
      } else if (specialty === "researcher") {
        params = buildResearcherPrompt(task);
      } else if (specialty === "calculator") {
        params = buildCalculatorPrompt(task);
      } else if (specialty === "critic") {
        params = buildCriticPrompt(task, criticContext || []);
      } else if (depth === 0 && activeFile) {
        params = buildRootMultimodalPrompt(task, activeFile, mode);
      } else if (depth === 0) {
        params = buildRootPrompt(task, mode);
      } else if (depth >= MAX_DEPTH) {
        params = buildLeafPrompt(task);
      } else if (depth === 1) {
        params = buildManagerPrompt(task);
      } else {
        params = buildWorkerPrompt(task);
      }

      const fallbackParams = buildFallbackParams(
        task,
        depth,
        specialty,
        customSpecialist,
      );
      const deadline = depth === 0 ? 45000 : depth === 1 ? 25000 : 15000;
      let responseText = await callOrFallback(params, fallbackParams, deadline);
      let parsed = parseAgentResponse(responseText);

      // Specialists (premade or custom) always answer directly — they never decompose
      if (specialty || customSpecialist) {
        let answer = parsed.type === "answer" ? parsed.answer : responseText;
        if (isJunkResult(answer)) {
          try {
            answer = await call(buildRetryPrompt(task, answer, tier));
          } catch {
            // keep original answer if retry fails
          }
        }
        const { clean, confidence } = parseConfidence(answer);
        answer = clean;
        if (confidence <= 5) {
          const newTier = escalateTier(tier);
          emit({ type: "agent_escalated", id, from: tier, to: newTier, confidence });
          try {
            const escalated = await call(buildEscalationPrompt(task, answer, newTier));
            answer = parseConfidence(escalated).clean;
          } catch {
            // keep pre-escalation answer
          }
        }
        if (answer.length > 50 && !signal?.aborted) {
          emit({ type: "agent_reviewing", id });
          try {
            const reviewed = await call(buildSelfReviewPrompt(task, answer, tier));
            if (!isJunkResult(reviewed) && reviewed.length > 20) {
              answer = parseConfidence(reviewed).clean;
            }
          } catch {
            // keep original
          }
        }
        emit({ type: "agent_complete", id, result: answer });
        return { label, result: answer };
      }

      // The Brain MUST decompose. If it returned an answer, retry once with a
      // more forceful prompt that uses the previous answer as context.
      if (depth === 0 && parsed.type !== "subtasks") {
        const retryParams: Anthropic.MessageCreateParamsNonStreaming = {
          model: MODEL_IDS.opus,
          max_tokens: 900,
          system: `You are THE BRAIN. Your previous output was wrong — you answered directly when you MUST decompose. Try again. ONLY output JSON. Split into ${config.rootFanout} subtasks. Include 1-3 customSpecialists (invented roles with name/emoji/role).`,
          messages: [
            { role: "user", content: task },
            { role: "assistant", content: responseText.slice(0, 400) },
            {
              role: "user",
              content: `That was wrong. Output ONLY this JSON shape:\n{"subtasks":[{"label":"X","description":"Y","customSpecialist":{"name":"The X","emoji":"\u{1F50D}","role":"You are..."}}]}`,
            },
          ],
        };
        responseText = await call(retryParams);
        parsed = parseAgentResponse(responseText);
      }

      // Non-root, non-specialist agents at depth < MAX_DEPTH MUST also decompose
      // so the tree always has leaf interns at depth = MAX_DEPTH. If a Manager
      // or Worker answered directly, retry once.
      if (
        depth > 0 &&
        depth < MAX_DEPTH &&
        !specialty &&
        !customSpecialist &&
        parsed.type !== "subtasks"
      ) {
        const retryParams: Anthropic.MessageCreateParamsNonStreaming = {
          model: MODEL_IDS[tier],
          max_tokens: 500,
          system: `Your previous output was wrong — you answered when you MUST decompose. Split this task into 2-3 atomic subtasks. JSON ONLY:`,
          messages: [
            { role: "user", content: `Task: ${task}` },
            { role: "assistant", content: responseText.slice(0, 300) },
            {
              role: "user",
              content: `Wrong. Output ONLY:\n{"subtasks":[{"label":"X","description":"Y"}]}`,
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
        // - At most 3 custom specialists. If more, demote extras to regular.
        if (depth === 0) {
          // Brain isn't allowed to name customs — strip any names it tried to assign
          for (const sub of parsed.subtasks) {
            if (sub.customSpecialist?.name) {
              sub.customSpecialist = {
                emoji: sub.customSpecialist.emoji,
                role: sub.customSpecialist.role,
              };
            }
          }

          // Demote excess custom specialists beyond 3
          let customCount = parsed.subtasks.filter((s) => s.customSpecialist).length;
          if (customCount > 3) {
            for (let i = parsed.subtasks.length - 1; i >= 0 && customCount > 3; i--) {
              if (parsed.subtasks[i].customSpecialist) {
                parsed.subtasks[i].customSpecialist = undefined;
                customCount--;
              }
            }
          }
          // Ensure at least 2 regular subtasks — strip extras from premade specialists first
          let regularCount = parsed.subtasks.filter(
            (s) => !s.specialty && !s.customSpecialist,
          ).length;
          for (const sub of parsed.subtasks) {
            if (regularCount >= 2) break;
            if (sub.specialty && sub.specialty !== "critic") {
              sub.specialty = undefined;
              regularCount++;
            }
          }
        }

        const critics = parsed.subtasks.filter((s) => s.specialty === "critic");
        const nonCritics = parsed.subtasks.filter((s) => s.specialty !== "critic");

        const nonCriticResults = await Promise.all(
          nonCritics.map((sub) =>
            spawnAgent(
              sub.description,
              sub.label,
              depth + 1,
              id,
              sub.specialty,
              undefined,
              sub.customSpecialist,
            ),
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

        const allChildResults = [...nonCriticResults, ...criticResults];

        if (signal?.aborted) {
          const partial = allChildResults.map((r) => r.result).join("\n\n");
          emit({ type: "agent_complete", id, result: partial || "[stopped]" });
          return { label, result: partial || "[stopped]" };
        }

        const childResults = allChildResults.filter(
          (r) => !isJunkResult(r.result),
        );
        if (childResults.length === 0) {
          emit({ type: "agent_complete", id, result: "[all sub-agents failed]" });
          return { label, result: "[all sub-agents failed]" };
        }

        const synthesisParams = buildSynthesisPrompt(task, childResults, tier);
        const synthesis = await call(synthesisParams);

        emit({ type: "agent_complete", id, result: synthesis });
        return { label, result: synthesis };
      } else {
        let answer =
          parsed.type === "answer" ? parsed.answer : responseText;
        if (isJunkResult(answer)) {
          try {
            answer = await call(buildRetryPrompt(task, answer, tier));
          } catch {
            // keep original answer if retry fails
          }
        }
        const { clean, confidence } = parseConfidence(answer);
        answer = clean;
        if (confidence <= 5) {
          const newTier = escalateTier(tier);
          emit({ type: "agent_escalated", id, from: tier, to: newTier, confidence });
          try {
            const escalated = await call(buildEscalationPrompt(task, answer, newTier));
            answer = parseConfidence(escalated).clean;
          } catch {
            // keep pre-escalation answer
          }
        }
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

    // Generate a one-line gist for the memory file. Cheap haiku call; fire
    // last so the user sees the synthesis pop first.
    try {
      const gist = (await call(buildGistPrompt(prompt, rootResult.result)))
        .trim()
        .replace(/^["']|["']$/g, "")
        .slice(0, 200);
      if (gist) {
        emit({ type: "memory_gist", prompt, gist, mode });
      }
    } catch {
      // ignore — memory is best-effort
    }
  }
  emit({ type: "done" });
}
