"use client";

import { useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { CustomSpecialist, DebateRole, ModelTier, Specialty, SPECIALTY_EMOJI } from "@/lib/types";

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
  customSpecialist?: CustomSpecialist;
  debateRole?: DebateRole;
  debateRound?: number;
}

const debateStyles: Record<
  DebateRole,
  { bg: string; border: string; glow: string; badgeBg: string; badgeText: string; glowColor: string; label: string }
> = {
  topic: {
    bg: "bg-amber-950/80",
    border: "border-amber-400",
    glow: "shadow-amber-500/60",
    badgeBg: "bg-amber-500",
    badgeText: "DEBATE",
    glowColor: "#f59e0b",
    label: "topic",
  },
  bull: {
    bg: "bg-red-950/80",
    border: "border-red-400",
    glow: "shadow-red-500/60",
    badgeBg: "bg-red-500",
    badgeText: "PRO",
    glowColor: "#ef4444",
    label: "bull",
  },
  bear: {
    bg: "bg-sky-950/80",
    border: "border-sky-400",
    glow: "shadow-sky-500/60",
    badgeBg: "bg-sky-500",
    badgeText: "CON",
    glowColor: "#0ea5e9",
    label: "bear",
  },
  judge: {
    bg: "bg-yellow-950/80",
    border: "border-yellow-400",
    glow: "shadow-yellow-500/60",
    badgeBg: "bg-yellow-500",
    badgeText: "VERDICT",
    glowColor: "#eab308",
    label: "judge",
  },
};

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

  const startedAtRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (isActive) {
      if (startedAtRef.current === null) {
        startedAtRef.current = Date.now();
        setElapsedMs(0);
      }
      const interval = setInterval(() => {
        if (startedAtRef.current) {
          setElapsedMs(Date.now() - startedAtRef.current);
        }
      }, 200);
      return () => clearInterval(interval);
    } else {
      startedAtRef.current = null;
    }
  }, [isActive]);

  const elapsedSec = elapsedMs / 1000;
  const isSlow = isActive && elapsedSec > 10;
  const isVerySlow = isActive && elapsedSec > 20;

  const burstClass: Record<string, string> = {
    opus: "animate-spawn-burst",
    sonnet: "animate-spawn-burst-blue",
    haiku: "animate-spawn-burst-green",
  };

  const debate = data.debateRole ? debateStyles[data.debateRole] : null;

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
        ${debate ? `${debate.bg} ${debate.border}` : data.customSpecialist ? "bg-fuchsia-950/80 border-fuchsia-400" : `${style.bg} ${style.border}`}
        ${debate && !isActive && !isDone ? `shadow-lg ${debate.glow}` : ""}
        ${debate && isDone ? `shadow-md ${debate.glow}` : ""}
        ${!debate && data.customSpecialist && !isActive && !isDone ? "shadow-lg shadow-fuchsia-500/30" : ""}
        ${!debate && data.customSpecialist && isDone ? "shadow-md shadow-fuchsia-500/40" : ""}
        ${isActive ? `shadow-lg ${debate ? debate.glow : data.customSpecialist ? "shadow-fuchsia-500/60" : style.glow} animate-ambient-glow` : ""}
        ${isDone && !debate && !data.customSpecialist ? "shadow-md animate-done-flash" : ""}
        ${isError ? "border-red-500 shadow-red-500/30" : ""}
        ${data.status === "spawning" ? `scale-90 opacity-0 animate-pop-in ${data.customSpecialist ? "animate-spawn-burst-fuchsia" : burstClass[data.model]}` : ""}
        ${isSelected ? `ring-2 ring-offset-2 ring-offset-zinc-950 ${debate ? "ring-amber-300" : data.customSpecialist ? "ring-fuchsia-400" : style.ring} brightness-125` : ""}
      `}
      style={isActive ? { color: debate ? debate.glowColor : data.customSpecialist ? "#d946ef" : style.glowColor } : undefined}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-white/30 !w-2 !h-2 !border-0"
      />

      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">
          {data.customSpecialist
            ? data.customSpecialist.emoji
            : data.specialty
              ? SPECIALTY_EMOJI[data.specialty]
              : tierEmoji[data.model]}
        </span>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white truncate max-w-[160px] ${
            debate
              ? debate.badgeBg
              : data.customSpecialist
                ? "bg-gradient-to-r from-fuchsia-500 to-pink-500"
                : data.specialty
                  ? "bg-amber-500"
                  : style.badge
          }`}
        >
          {debate
            ? debate.badgeText + (data.debateRound ? ` R${data.debateRound}` : "")
            : data.customSpecialist
              ? data.customSpecialist.name || "\u{2728} self-naming..."
              : data.specialty
                ? data.specialty
                : data.model}
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
          <span
            className={`text-xs ml-auto font-mono tabular-nums ${
              isVerySlow
                ? "text-orange-400"
                : isSlow
                  ? "text-yellow-300"
                  : "text-yellow-400 animate-pulse"
            }`}
          >
            {elapsedSec.toFixed(1)}s
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
