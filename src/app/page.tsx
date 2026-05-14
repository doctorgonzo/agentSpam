"use client";

import { useCallback, useRef, useState } from "react";
import { AgentNode, AgentEvent, FileAttachment } from "@/lib/types";
import AgentTree from "@/components/AgentTree";
import InputPanel from "@/components/InputPanel";
import ResultPanel from "@/components/ResultPanel";
import DetailPanel from "@/components/DetailPanel";

export default function Home() {
  const [agents, setAgents] = useState<Map<string, AgentNode>>(new Map());
  const [isRunning, setIsRunning] = useState(false);
  const [finalResult, setFinalResult] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentNode | null>(null);
  const agentsRef = useRef<Map<string, AgentNode>>(new Map());

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

  const handleSelectAgent = useCallback(
    (id: string) => {
      const agent = agentsRef.current.get(id);
      setSelectedAgent(agent || null);
    },
    [],
  );

  const handleSubmit = useCallback(
    async (prompt: string, file?: FileAttachment) => {
      setIsRunning(true);
      setFinalResult(null);
      setSelectedAgent(null);
      agentsRef.current = new Map();
      setAgents(new Map());

      try {
        const res = await fetch("/api/spawn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, file }),
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
      <header className="flex-none px-6 py-4 border-b border-white/5">
        <div className="flex items-center justify-between max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-purple-400">agent</span>
              <span className="text-white">Spam</span>
            </h1>
            <span className="text-white/20 text-xs hidden sm:inline">
              one brain, infinite idiots
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-white/30">
            {hasAgents && (
              <>
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
                <span className="text-white/20 ml-2">
                  {agents.size} agents
                </span>
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
            <InputPanel onSubmit={handleSubmit} isRunning={isRunning} />
          </div>
        ) : (
          <>
            <div className="flex-none p-4 pb-2">
              <InputPanel onSubmit={handleSubmit} isRunning={isRunning} />
            </div>

            <div className="flex-1 min-h-[300px] relative">
              <AgentTree
                agents={agents}
                onSelectAgent={handleSelectAgent}
              />
              <DetailPanel
                agent={selectedAgent}
                onClose={() => setSelectedAgent(null)}
              />
            </div>

            {finalResult && (
              <div className="flex-none p-4 pt-2">
                <ResultPanel
                  result={finalResult}
                  agentCount={agents.size}
                />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
