"use client";

import { useRef, useState } from "react";
import { FileAttachment, MISSION_MODES, MissionMode } from "@/lib/types";

interface InputPanelProps {
  onSubmit: (prompt: string, file?: FileAttachment, mode?: MissionMode) => void;
  onStop: () => void;
  isRunning: boolean;
}

export default function InputPanel({ onSubmit, onStop, isRunning }: InputPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<FileAttachment | null>(null);
  const [mode, setMode] = useState<MissionMode>("generalist");
  const fileRef = useRef<HTMLInputElement>(null);
  const currentMode = MISSION_MODES.find((m) => m.id === mode);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setFile({ data: base64, mediaType: f.type, name: f.name });
    };
    reader.readAsDataURL(f);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() && !file) return;
    onSubmit(prompt, file ?? undefined, mode);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Give the Brain a task... or upload a file and let it loose"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 resize-none text-sm"
            rows={3}
            disabled={isRunning}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleSubmit(e);
              }
            }}
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            onChange={handleFile}
            accept="image/*,.pdf"
            className="hidden"
          />

          <div className="relative">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as MissionMode)}
              disabled={isRunning}
              title={currentMode?.description}
              className="appearance-none cursor-pointer pl-7 pr-7 py-2 bg-white/5 border border-white/10 rounded-lg text-white/70 hover:text-white hover:border-white/20 focus:outline-none focus:border-purple-500/40 transition-all text-xs disabled:opacity-30"
            >
              {MISSION_MODES.map((m) => (
                <option key={m.id} value={m.id} className="bg-zinc-900">
                  {m.label}
                </option>
              ))}
            </select>
            <span className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none text-sm">
              {currentMode?.emoji}
            </span>
            <svg
              className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none w-3 h-3 text-white/40"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>


          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={isRunning}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white/50 hover:text-white/80 hover:border-white/20 transition-all text-xs disabled:opacity-30"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              />
            </svg>
            {file ? file.name : "Attach file"}
          </button>

          {file && (
            <button
              type="button"
              onClick={() => {
                setFile(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="text-red-400/60 hover:text-red-400 text-xs transition-colors"
            >
              remove
            </button>
          )}

          <div className="flex-1" />

          <span className="text-white/20 text-xs">
            {isRunning ? "" : "Cmd+Enter to send"}
          </span>

          {isRunning ? (
            <button
              type="button"
              onClick={onStop}
              className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg transition-all text-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <rect x="4" y="4" width="12" height="12" rx="2" />
              </svg>
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!prompt.trim() && !file}
              className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-white/5 disabled:text-white/20 text-white font-medium rounded-lg transition-all text-sm"
            >
              Unleash
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
