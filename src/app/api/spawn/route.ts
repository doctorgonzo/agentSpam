import { runAgentTree } from "@/lib/agent-engine";
import { AgentEvent, SpawnRequest } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body: SpawnRequest = await req.json();
  const { prompt, file, files, mode, role, memory } = body;

  // Normalize to a files array — legacy single `file` still works.
  const allFiles = files && files.length > 0 ? files : file ? [file] : [];

  if (!prompt && allFiles.length === 0) {
    return new Response(JSON.stringify({ error: "Need a prompt or file" }), {
      status: 400,
    });
  }

  const encoder = new TextEncoder();

  const abort = new AbortController();

  try {
    req.signal.addEventListener("abort", () => abort.abort());
  } catch {
    // some runtimes don't support req.signal
  }

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // stream closed
        }
      };

      try {
        await runAgentTree(prompt, allFiles, emit, abort.signal, mode, role, memory);
      } catch (err) {
        if (!abort.signal.aborted) {
          const msg = err instanceof Error ? err.message : "Engine failed";
          emit({ type: "agent_error", id: "root", error: msg });
        }
        emit({ type: "done" });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
