"use client";

import ReactMarkdown from "react-markdown";

interface ResultPanelProps {
  result: string | null;
  agentCount: number;
  onClose: () => void;
}

export default function ResultPanel({ result, agentCount, onClose }: ResultPanelProps) {
  if (!result) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-3xl max-h-[85vh] mx-4 flex flex-col bg-zinc-900 border border-purple-500/30 rounded-2xl shadow-2xl shadow-purple-500/10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 flex-none">
          <div className="w-3 h-3 rounded-full bg-purple-400 animate-pulse" />
          <span className="text-purple-300 text-sm font-bold uppercase tracking-wider">
            Final Synthesis
          </span>
          <span className="text-white/30 text-xs ml-2">
            {agentCount} agents contributed
          </span>
          <button
            onClick={onClose}
            className="ml-auto text-white/30 hover:text-white text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-all"
          >
            Back to tree
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="prose prose-invert prose-base max-w-none prose-headings:text-purple-200 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-strong:text-white prose-p:text-white/80 prose-p:leading-relaxed prose-li:text-white/80 prose-code:text-purple-300 prose-hr:border-white/10 prose-a:text-purple-400">
            <ReactMarkdown>{result}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
