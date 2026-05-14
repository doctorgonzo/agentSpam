import { runAgentTree } from "@/lib/agent-engine";
import { AgentEvent, SpawnRequest } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body: SpawnRequest = await req.json();
  const { prompt, file } = body;

  if (!prompt && !file) {
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
        await runAgentTree(prompt, file, emit, abort.signal);
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
