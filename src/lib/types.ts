export type ModelTier = "opus" | "sonnet" | "haiku";

export type Specialty = "researcher" | "calculator" | "critic";

export interface AgentNode {
  id: string;
  parentId: string | null;
  depth: number;
  model: ModelTier;
  task: string;
  label: string;
  status: "spawning" | "thinking" | "complete" | "error";
  result?: string;
  specialty?: Specialty;
}

export const SPECIALTY_LABELS: Record<Specialty, string> = {
  researcher: "The Researcher",
  calculator: "The Calculator",
  critic: "The Critic",
};

export const SPECIALTY_EMOJI: Record<Specialty, string> = {
  researcher: "\u{1F50D}",
  calculator: "\u{1F522}",
  critic: "\u{1F928}",
};

export type AgentEvent =
  | { type: "scout_searching" }
  | { type: "scout_complete"; findings: string | null }
  | { type: "agent_spawned"; agent: AgentNode }
  | { type: "agent_thinking"; id: string }
  | { type: "agent_complete"; id: string; result: string }
  | { type: "agent_error"; id: string; error: string }
  | { type: "cost_update"; totalCost: number; humanMinutes: number }
  | { type: "final_result"; result: string }
  | { type: "done" };

export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3 / 1e6, output: 15 / 1e6 },
  "claude-haiku-4-5-20251001": { input: 1 / 1e6, output: 5 / 1e6 },
};

export const WEB_SEARCH_COST = 0.01;

export interface FileAttachment {
  data: string;
  mediaType: string;
  name: string;
}

export interface SpawnRequest {
  prompt: string;
  file?: FileAttachment;
}

export const MODEL_IDS: Record<ModelTier, string> = {
  opus: "claude-sonnet-4-6", // using sonnet as "brain" to save $$ — swap to opus for demo day
  sonnet: "claude-haiku-4-5-20251001",
  haiku: "claude-haiku-4-5-20251001",
};

export const MODEL_LABELS: Record<ModelTier, string> = {
  opus: "The Brain",
  sonnet: "Middle Mgmt",
  haiku: "The Intern",
};

export const MAX_DEPTH = 3;
export const MAX_AGENTS = 30;
