"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentNode,
  AgentEvent,
  FileAttachment,
  MissionMode,
  MISSION_MODES,
  WORKER_ROLES,
} from "@/lib/types";
import {
  MemoryEntry,
  getMemory,
  addMemoryEntry,
  removeMemoryEntry,
  clearMemory,
  formatMemoryForBrain,
} from "@/lib/memory";
import { generateHtmlReport } from "@/lib/report";
import { spawnSound, thinkingSound, completeSound, errorSound, synthesisSound } from "@/lib/sounds";
import AgentTree from "@/components/AgentTree";
import InputPanel from "@/components/InputPanel";
import ResultPanel from "@/components/ResultPanel";
import DetailPanel from "@/components/DetailPanel";

export default function Home() {
  const [agents, setAgents] = useState<Map<string, AgentNode>>(new Map());
  const [isRunning, setIsRunning] = useState(false);
  const [finalResult, setFinalResult] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [scoutStatus, setScoutStatus] = useState<"idle" | "searching" | "found" | "none">("idle");
  const [scoutFindings, setScoutFindings] = useState<string | null>(null);
  const [scoutElapsedMs, setScoutElapsedMs] = useState(0);
  const scoutStartRef = useRef<number | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [humanMinutes, setHumanMinutes] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [lastMode, setLastMode] = useState<MissionMode>("generalist");
  const [lastRole, setLastRole] = useState<string>("none");
  const [lastFileCount, setLastFileCount] = useState(0);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [showMemory, setShowMemory] = useState(false);
  const agentsRef = useRef<Map<string, AgentNode>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const updateAgent = useCallback(
    (id: string, updates: Partial<AgentNode>) => {
      agentsRef.current = new Map(agentsRef.current);
      const existing = agentsRef.current.get(id);
      if (existing) {
        agentsRef.current.set(id, { ...existing, ...updates });
      }
      setAgents(new Map(agentsRef.current));
    },
    [],
  );

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedAgentId((prev) => (prev === id || !id ? null : id));
  }, []);

  const selectedAgent = useMemo(() => {
    if (!selectedAgentId) return null;
    return agents.get(selectedAgentId) ?? null;
  }, [agents, selectedAgentId]);

  const stats = useMemo(() => {
    let active = 0;
    let done = 0;
    let errors = 0;
    agents.forEach((a) => {
      if (a.status === "thinking" || a.status === "spawning") active++;
      else if (a.status === "complete") done++;
      else if (a.status === "error") errors++;
    });
    return { total: agents.size, active, done, errors };
  }, [agents]);

  useEffect(() => {
    setMemory(getMemory());
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedMs(Date.now() - startTimeRef.current);
      }
      if (scoutStartRef.current && scoutStatus === "searching") {
        setScoutElapsedMs(Date.now() - scoutStartRef.current);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isRunning, scoutStatus]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }, []);

  const handleExport = useCallback(() => {
    const html = generateHtmlReport({
      prompt: lastPrompt,
      mode: lastMode,
      role: lastRole,
      fileCount: lastFileCount,
      totalCost,
      elapsedMs,
      humanMinutes,
      agents,
      finalResult,
    });

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `agentspam-run-${stamp}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [
    agents,
    finalResult,
    totalCost,
    elapsedMs,
    humanMinutes,
    lastPrompt,
    lastMode,
    lastRole,
    lastFileCount,
  ]);

  const handleSubmit = useCallback(
    async (
      prompt: string,
      files: FileAttachment[],
      mode: MissionMode,
      role: string,
    ) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setIsRunning(true);
      setFinalResult(null);
      setSelectedAgentId(null);
      setScoutStatus("idle");
      setScoutFindings(null);
      setScoutElapsedMs(0);
      scoutStartRef.current = null;
      setTotalCost(0);
      setHumanMinutes(0);
      setElapsedMs(0);
      startTimeRef.current = Date.now();
      agentsRef.current = new Map();
      setAgents(new Map());

      setLastPrompt(prompt);
      setLastMode(mode);
      setLastRole(role);
      setLastFileCount(files.length);

      const memoryBlock = formatMemoryForBrain(getMemory());

      try {
        const res = await fetch("/api/spawn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, files, mode, role, memory: memoryBlock }),
          signal: ac.signal,
        });

        if (!res.ok) throw new Error("API error");

        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6);
            try {
              const event: AgentEvent = JSON.parse(json);

              switch (event.type) {
                case "scout_searching":
                  setScoutStatus("searching");
                  scoutStartRef.current = Date.now();
                  setScoutElapsedMs(0);
                  break;

                case "scout_complete":
                  setScoutStatus(event.findings ? "found" : "none");
                  setScoutFindings(event.findings);
                  if (scoutStartRef.current) {
                    setScoutElapsedMs(Date.now() - scoutStartRef.current);
                  }
                  break;

                case "cost_update":
                  setTotalCost(event.totalCost);
                  setHumanMinutes(event.humanMinutes);
                  break;

                case "agent_spawned":
                  agentsRef.current = new Map(agentsRef.current);
                  agentsRef.current.set(event.agent.id, event.agent);
                  setAgents(new Map(agentsRef.current));
                  spawnSound();
                  break;

                case "agent_thinking":
                  updateAgent(event.id, { status: "thinking" });
                  thinkingSound();
                  break;

                case "agent_complete":
                  updateAgent(event.id, {
                    status: "complete",
                    result: event.result,
                  });
                  completeSound();
                  break;

                case "agent_named": {
                  const existing = agentsRef.current.get(event.id);
                  if (existing?.customSpecialist) {
                    updateAgent(event.id, {
                      customSpecialist: {
                        ...existing.customSpecialist,
                        name: event.name,
                      },
                    });
                  }
                  break;
                }

                case "memory_gist": {
                  const updated = addMemoryEntry({
                    prompt: event.prompt,
                    gist: event.gist,
                    mode: event.mode,
                  });
                  setMemory(updated);
                  break;
                }

                case "agent_error":
                  updateAgent(event.id, { status: "error" });
                  errorSound();
                  break;

                case "final_result":
                  setFinalResult(event.result);
                  setShowResult(true);
                  synthesisSound();
                  break;

                case "done":
                  setIsRunning(false);
                  break;
              }
            } catch {
              // skip malformed events
            }
          }
        }
      } catch (err) {
        console.error("Stream error:", err);
      }

      setIsRunning(false);
    },
    [updateAgent],
  );

  const hasAgents = agents.size > 0;

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-hidden">
      {/* Header */}
      <header className="flex-none px-6 py-3 border-b border-white/5">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-purple-400">agent</span>
              <span className="text-white">Spam</span>
            </h1>
            <span className="text-white/20 text-xs hidden sm:inline">
              one brain, infinite idiots
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {(isRunning || totalCost > 0) && (
              <div
                title="Estimated cost vs. equivalent human work time"
                className="flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[11px] font-mono"
              >
                <span>${totalCost.toFixed(4)}</span>
                <span className="text-white/20">·</span>
                <span>{(elapsedMs / 1000).toFixed(1)}s</span>
                {humanMinutes > 0 && (
                  <>
                    <span className="text-white/20">·</span>
                    <span className="text-emerald-200">
                      saves ~{humanMinutes}min
                    </span>
                  </>
                )}
              </div>
            )}
            {memory.length > 0 && (
              <button
                onClick={() => setShowMemory((v) => !v)}
                title={`${memory.length} past runs in local memory — the Brain can build on these`}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 text-[11px] hover:bg-indigo-500/20 transition-all"
              >
                <span>{"\u{1F4DA}"}</span>
                <span>{memory.length} {memory.length === 1 ? "memory" : "memories"}</span>
              </button>
            )}
            {scoutStatus !== "idle" && (
              <div
                title={scoutFindings || (scoutStatus === "none" ? "No live data needed" : "Scout searching...")}
                className={`
                  relative overflow-hidden flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] min-w-[200px]
                  ${scoutStatus === "searching" ? "border-cyan-500/40 bg-cyan-500/5 text-cyan-300" : ""}
                  ${scoutStatus === "found" ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" : ""}
                  ${scoutStatus === "none" ? "border-white/10 bg-white/5 text-white/40" : ""}
                `}
              >
                {scoutStatus === "searching" && (
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500/30 to-cyan-400/40 transition-all duration-100 ease-out"
                    style={{
                      width: `${Math.min(95, (1 - Math.exp(-scoutElapsedMs / 12000)) * 100)}%`,
                    }}
                  />
                )}
                {scoutStatus === "found" && (
                  <div className="absolute inset-0 bg-cyan-500/15" />
                )}
                <svg className="w-3 h-3 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <div className="flex items-center gap-1.5 relative z-10 flex-1 justify-between">
                  {scoutStatus === "searching" && (
                    <>
                      <span>Scout searching</span>
                      <span className="font-mono text-cyan-400/80">
                        {(scoutElapsedMs / 1000).toFixed(1)}s
                      </span>
                    </>
                  )}
                  {scoutStatus === "found" && (
                    <>
                      <span>Scout found data</span>
                      <span className="font-mono text-cyan-400/60">
                        {(scoutElapsedMs / 1000).toFixed(1)}s
                      </span>
                    </>
                  )}
                  {scoutStatus === "none" && <span>No live data needed</span>}
                </div>
              </div>
            )}
            {hasAgents && (
              <>
                <div className="flex items-center gap-3 text-white/30">
                  <span>
                    <span className="inline-block w-2 h-2 rounded-full bg-purple-400 mr-1" />
                    Brain
                  </span>
                  <span>
                    <span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1" />
                    Mid
                  </span>
                  <span>
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1" />
                    Intern
                  </span>
                </div>
                <div className="h-4 w-px bg-white/10" />
                <div className="flex items-center gap-2 text-white/40 font-mono">
                  {stats.active > 0 && (
                    <span className="text-yellow-400">
                      {stats.active} active
                    </span>
                  )}
                  <span className="text-emerald-400/70">
                    {stats.done} done
                  </span>
                  {stats.errors > 0 && (
                    <span className="text-red-400/70">
                      {stats.errors} err
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main area */}
      <main className="flex-1 flex flex-col min-h-0 relative">
        {!hasAgents ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-8 p-6">
            <div className="text-center">
              <div className="text-6xl mb-4">{"\u{1F9E0}"}</div>
              <h2 className="text-2xl font-bold mb-2">
                One brain. Infinite idiots.
              </h2>
              <p className="text-white/40 text-sm max-w-md">
                Give the Brain a task. It&apos;ll spawn progressively dumber
                agents that each do one thing. The tree of idiots collectively
                produces something brilliant.
              </p>
            </div>
            <InputPanel onSubmit={handleSubmit} onStop={handleStop} isRunning={isRunning} />
          </div>
        ) : (
          <>
            <div className="flex-none p-4 pb-2">
              <InputPanel onSubmit={handleSubmit} onStop={handleStop} isRunning={isRunning} />
            </div>

            <div className="flex-1 min-h-[300px] relative">
              <AgentTree
                agents={agents}
                onSelectAgent={handleSelectAgent}
                selectedAgentId={selectedAgentId}
              />

              {/* Hint overlay */}
              {!selectedAgentId && !isRunning && stats.done > 0 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/20 text-xs bg-zinc-900/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/5 pointer-events-none animate-fade-in">
                  click any agent to inspect
                </div>
              )}

              <DetailPanel
                agent={selectedAgent}
                onClose={() => setSelectedAgentId(null)}
              />
            </div>

            {finalResult && !showResult && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 animate-fade-in">
                <button
                  onClick={() => setShowResult(true)}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-full shadow-lg shadow-purple-500/20 transition-all flex items-center gap-2"
                >
                  <div className="w-2 h-2 rounded-full bg-white/80" />
                  Show Final Synthesis
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {showResult && (
        <ResultPanel
          result={finalResult}
          agentCount={agents.size}
          onClose={() => setShowResult(false)}
          onExport={handleExport}
          totalCost={totalCost}
          elapsedMs={elapsedMs}
          humanMinutes={humanMinutes}
          role={lastRole}
        />
      )}

      {showMemory && (
        <div
          className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-start justify-end animate-fade-in"
          onClick={() => setShowMemory(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[380px] h-full bg-zinc-900 border-l border-indigo-500/30 flex flex-col"
          >
            <div className="flex-none flex items-center gap-3 px-5 py-4 border-b border-white/10">
              <span className="text-lg">{"\u{1F4DA}"}</span>
              <div className="flex-1">
                <div className="text-indigo-300 text-sm font-bold uppercase tracking-wider">
                  Team Memory
                </div>
                <div className="text-white/40 text-[11px]">
                  {memory.length} past run{memory.length === 1 ? "" : "s"} the
                  Brain can build on
                </div>
              </div>
              <button
                onClick={() => setShowMemory(false)}
                className="text-white/30 hover:text-white text-xs bg-white/5 hover:bg-white/10 px-2 py-1 rounded"
              >
                ESC
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {memory.length === 0 && (
                <div className="text-white/30 text-sm italic">
                  No memories yet. Each run adds one when it completes.
                </div>
              )}
              {memory.map((m) => {
                const d = new Date(m.timestamp);
                return (
                  <div
                    key={m.id}
                    className="group bg-white/5 border border-white/10 hover:border-indigo-500/30 rounded-lg p-3 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="text-indigo-300 text-[10px] font-mono uppercase tracking-wider">
                        {d.toLocaleDateString()}{" "}
                        {d.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {m.mode && m.mode !== "generalist" && (
                          <span className="ml-2 text-white/30">
                            · {m.mode}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setMemory(removeMemoryEntry(m.id))}
                        className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-300 text-[11px] transition-all"
                      >
                        delete
                      </button>
                    </div>
                    <div className="text-white/50 text-[11px] mb-1 truncate">
                      {m.prompt}
                    </div>
                    <div className="text-white/90 text-sm leading-snug">
                      {m.gist}
                    </div>
                  </div>
                );
              })}
            </div>

            {memory.length > 0 && (
              <div className="flex-none p-4 border-t border-white/10">
                <button
                  onClick={() => {
                    if (confirm("Clear all team memory? This can't be undone.")) {
                      setMemory(clearMemory());
                    }
                  }}
                  className="w-full px-3 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-medium rounded-lg transition-all"
                >
                  Clear all memory
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
