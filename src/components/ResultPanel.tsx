"use client";

import ReactMarkdown from "react-markdown";

interface ResultPanelProps {
  result: string | null;
  agentCount: number;
}

export default function ResultPanel({ result, agentCount }: ResultPanelProps) {
  if (!result) return null;

  return (
    <div className="w-full max-w-2xl mx-auto animate-fade-in">
      <div className="bg-white/5 border border-purple-500/30 rounded-xl p-5 backdrop-blur-sm max-h-[40vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-3 sticky top-0 bg-white/5 backdrop-blur-sm -mt-5 -mx-5 px-5 pt-5 pb-3">
          <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
          <span className="text-purple-300 text-xs font-semibold uppercase tracking-wider">
            Final Synthesis
          </span>
          <span className="text-white/20 text-xs ml-auto">
            {agentCount} agents spawned
          </span>
        </div>
        <div className="prose prose-invert prose-sm max-w-none prose-headings:text-purple-200 prose-strong:text-white prose-p:text-white/80 prose-li:text-white/80 prose-hr:border-white/10">
          <ReactMarkdown>{result}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
