"use client";

import { Handle, Position } from "@xyflow/react";
import { ModelTier } from "@/lib/types";

const tierStyles: Record<
  ModelTier,
  { bg: string; border: string; glow: string; badge: string }
> = {
  opus: {
    bg: "bg-purple-950/80",
    border: "border-purple-400",
    glow: "shadow-purple-500/50",
    badge: "bg-purple-500",
  },
  sonnet: {
    bg: "bg-blue-950/80",
    border: "border-blue-400",
    glow: "shadow-blue-500/50",
    badge: "bg-blue-500",
  },
  haiku: {
    bg: "bg-emerald-950/80",
    border: "border-emerald-400",
    glow: "shadow-emerald-500/50",
    badge: "bg-emerald-500",
  },
};

const tierEmoji: Record<ModelTier, string> = {
  opus: "\u{1F9E0}",
  sonnet: "\u{1F468}\u200D\u{1F4BC}",
  haiku: "\u{1F476}",
};

interface AgentNodeData {
  label: string;
  model: ModelTier;
  status: "spawning" | "thinking" | "complete" | "error";
  task: string;
  result?: string;
  onSelect?: (id: string) => void;
  nodeId?: string;
}

export default function AgentNodeComponent({
  data,
}: {
  data: AgentNodeData;
}) {
  const style = tierStyles[data.model];
  const isActive = data.status === "thinking" || data.status === "spawning";
  const isDone = data.status === "complete";
  const isError = data.status === "error";

  return (
    <div
      onClick={() => data.onSelect?.(data.nodeId || "")}
      className={`
        relative rounded-xl border-2 px-4 py-3 min-w-[200px] max-w-[260px]
        backdrop-blur-sm transition-all duration-500 cursor-pointer
        hover:brightness-125
        ${style.bg} ${style.border}
        ${isActive ? `shadow-lg ${style.glow} animate-pulse` : ""}
        ${isDone ? "shadow-md opacity-100" : ""}
        ${isError ? "border-red-500 shadow-red-500/50" : ""}
        ${data.status === "spawning" ? "scale-90 opacity-0 animate-pop-in" : "opacity-100"}
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-white/30 !w-2 !h-2 !border-0"
      />

      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{tierEmoji[data.model]}</span>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${style.badge} text-white`}
        >
          {data.model}
        </span>
        {isDone && (
          <span className="text-emerald-400 text-xs ml-auto">done</span>
        )}
        {isActive && (
          <span className="text-yellow-400 text-xs ml-auto animate-pulse">
            thinking...
          </span>
        )}
        {isError && (
          <span className="text-red-400 text-xs ml-auto">error</span>
        )}
      </div>

      <div className="text-white font-semibold text-sm truncate">
        {data.label}
      </div>

      {/* Task preview — what this agent was assigned */}
      <div className="text-white/40 text-[11px] mt-1 line-clamp-2 leading-tight">
        {data.task.slice(0, 120)}
        {data.task.length > 120 ? "..." : ""}
      </div>

      {/* Result preview when done */}
      {isDone && data.result && (
        <div className="text-white/70 text-xs mt-2 pt-2 border-t border-white/10 line-clamp-2">
          {data.result.slice(0, 120)}
          {data.result.length > 120 ? "..." : ""}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-white/30 !w-2 !h-2 !border-0"
      />
    </div>
  );
}
