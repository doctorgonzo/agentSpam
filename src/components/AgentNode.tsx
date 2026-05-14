"use client";

import { Handle, Position } from "@xyflow/react";
import { ModelTier, Specialty, SPECIALTY_EMOJI, SPECIALTY_LABELS } from "@/lib/types";

const tierStyles: Record<
  ModelTier,
  { bg: string; border: string; glow: string; badge: string; ring: string; glowColor: string }
> = {
  opus: {
    bg: "bg-purple-950/80",
    border: "border-purple-400",
    glow: "shadow-purple-500/50",
    badge: "bg-purple-500",
    ring: "ring-purple-400",
    glowColor: "#a855f7",
  },
  sonnet: {
    bg: "bg-blue-950/80",
    border: "border-blue-400",
    glow: "shadow-blue-500/50",
    badge: "bg-blue-500",
    ring: "ring-blue-400",
    glowColor: "#3b82f6",
  },
  haiku: {
    bg: "bg-emerald-950/80",
    border: "border-emerald-400",
    glow: "shadow-emerald-500/50",
    badge: "bg-emerald-500",
    ring: "ring-emerald-400",
    glowColor: "#10b981",
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
  selected?: boolean;
  specialty?: Specialty;
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
  const isSelected = data.selected;

  const burstClass: Record<string, string> = {
    opus: "animate-spawn-burst",
    sonnet: "animate-spawn-burst-blue",
    haiku: "animate-spawn-burst-green",
  };

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        data.onSelect?.(data.nodeId || "");
      }}
      className={`
        relative rounded-xl border-2 px-4 py-3 min-w-[200px] max-w-[260px]
        backdrop-blur-sm transition-all duration-300 cursor-pointer
        hover:brightness-125 hover:scale-[1.02]
        ${style.bg} ${style.border}
        ${isActive ? `shadow-lg ${style.glow} animate-ambient-glow` : ""}
        ${isDone ? "shadow-md animate-done-flash" : ""}
        ${isError ? "border-red-500 shadow-red-500/30" : ""}
        ${data.status === "spawning" ? `scale-90 opacity-0 animate-pop-in ${burstClass[data.model]}` : ""}
        ${isSelected ? `ring-2 ring-offset-2 ring-offset-zinc-950 ${style.ring} brightness-125` : ""}
      `}
      style={isActive ? { color: style.glowColor } : undefined}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-white/30 !w-2 !h-2 !border-0"
      />

      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">
          {data.specialty ? SPECIALTY_EMOJI[data.specialty] : tierEmoji[data.model]}
        </span>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${data.specialty ? "bg-amber-500" : style.badge} text-white`}
        >
          {data.specialty ? data.specialty : data.model}
        </span>
        {isDone && (
          <span className="text-emerald-400 text-xs ml-auto flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            done
          </span>
        )}
        {isActive && (
          <span className="text-yellow-400 text-xs ml-auto animate-pulse">
            thinking...
          </span>
        )}
        {isError && (
          <span className="text-red-400 text-xs ml-auto flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            error
          </span>
        )}
      </div>

      <div className="text-white font-semibold text-sm truncate">
        {data.label}
      </div>

      <div className="text-white/40 text-[11px] mt-1 line-clamp-2 leading-tight">
        {data.task.slice(0, 120)}
        {data.task.length > 120 ? "..." : ""}
      </div>

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
