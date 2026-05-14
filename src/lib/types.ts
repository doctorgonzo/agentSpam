export type ModelTier = "opus" | "sonnet" | "haiku";

export interface AgentNode {
  id: string;
  parentId: string | null;
  depth: number;
  model: ModelTier;
  task: string;
  label: string;
  status: "spawning" | "thinking" | "complete" | "error";
  result?: string;
}

export type AgentEvent =
  | { type: "agent_spawned"; agent: AgentNode }
  | { type: "agent_thinking"; id: string }
  | { type: "agent_complete"; id: string; result: string }
  | { type: "agent_error"; id: string; error: string }
  | { type: "final_result"; result: string }
  | { type: "done" };

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

export const MAX_DEPTH = 5;
export const MAX_AGENTS = 30;
