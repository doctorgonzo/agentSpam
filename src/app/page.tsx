"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AgentNode, AgentEvent, FileAttachment } from "@/lib/types";
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

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }, []);

  const handleSubmit = useCallback(
    async (prompt: string, file?: FileAttachment) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setIsRunning(true);
      setFinalResult(null);
      setSelectedAgentId(null);
      agentsRef.current = new Map();
      setAgents(new Map());

      try {
        const res = await fetch("/api/spawn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, file }),
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
                case "agent_spawned":
                  agentsRef.current = new Map(agentsRef.current);
                  agentsRef.current.set(event.agent.id, event.agent);
                  setAgents(new Map(agentsRef.current));
                  break;

                case "agent_thinking":
                  updateAgent(event.id, { status: "thinking" });
                  break;

                case "agent_complete":
                  updateAgent(event.id, {
                    status: "complete",
                    result: event.result,
                  });
                  break;

                case "agent_error":
                  updateAgent(event.id, { status: "error" });
                  break;

                case "final_result":
                  setFinalResult(event.result);
                  setShowResult(true);
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
        />
      )}
    </div>
  );
}
