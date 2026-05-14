"use client";

import { AgentNode, MODEL_LABELS, ModelTier } from "@/lib/types";

const tierColors: Record<ModelTier, string> = {
  opus: "text-purple-400 border-purple-500/30",
  sonnet: "text-blue-400 border-blue-500/30",
  haiku: "text-emerald-400 border-emerald-500/30",
};

interface DetailPanelProps {
  agent: AgentNode | null;
  onClose: () => void;
}

export default function DetailPanel({ agent, onClose }: DetailPanelProps) {
  if (!agent) return null;

  const color = tierColors[agent.model];

  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-zinc-900/95 backdrop-blur-md border-l border-white/10 z-50 flex flex-col animate-slide-in">
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-bold uppercase tracking-wider ${color}`}
          >
            {MODEL_LABELS[agent.model]}
          </span>
          <span className="text-white/30 text-xs">#{agent.id}</span>
        </div>
        <button
          onClick={onClose}
          className="text-white/30 hover:text-white text-sm transition-colors"
        >
          esc
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Agent name */}
        <div>
          <div className="text-white/40 text-[10px] uppercase tracking-wider mb-1">
            Agent
          </div>
          <div className="text-white font-semibold">{agent.label}</div>
        </div>

        {/* Status */}
        <div>
          <div className="text-white/40 text-[10px] uppercase tracking-wider mb-1">
            Status
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                agent.status === "complete"
                  ? "bg-emerald-400"
                  : agent.status === "error"
                    ? "bg-red-400"
                    : "bg-yellow-400 animate-pulse"
              }`}
            />
            <span className="text-white/80 text-sm capitalize">
              {agent.status}
            </span>
          </div>
        </div>

        {/* Assigned task */}
        <div>
          <div className="text-white/40 text-[10px] uppercase tracking-wider mb-1">
            Assigned Task
          </div>
          <div className="text-white/70 text-sm leading-relaxed bg-white/5 rounded-lg p-3">
            {agent.task}
          </div>
        </div>

        {/* Depth */}
        <div>
          <div className="text-white/40 text-[10px] uppercase tracking-wider mb-1">
            Depth
          </div>
          <div className="flex items-center gap-1">
            {Array.from({ length: agent.depth + 1 }).map((_, i) => (
              <div
                key={i}
                className={`w-3 h-3 rounded-sm ${
                  i <= agent.depth
                    ? agent.model === "opus"
                      ? "bg-purple-500"
                      : agent.model === "sonnet"
                        ? "bg-blue-500"
                        : "bg-emerald-500"
                    : "bg-white/10"
                }`}
              />
            ))}
            <span className="text-white/40 text-xs ml-2">
              Level {agent.depth}
            </span>
          </div>
        </div>

        {/* Result */}
        {agent.result && (
          <div>
            <div className="text-white/40 text-[10px] uppercase tracking-wider mb-1">
              Output
            </div>
            <div className="text-white/80 text-sm leading-relaxed bg-white/5 rounded-lg p-3 max-h-[300px] overflow-y-auto">
              {agent.result}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
