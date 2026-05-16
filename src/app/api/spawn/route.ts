import { runAgentTree } from "@/lib/agent-engine";
import { AgentEvent, SpawnRequest } from "@/lib/types";
import { budgetStatus, recordCost } from "@/lib/budget";

export const maxDuration = 300;

export async function POST(req: Request) {
  // Demo token gate. If DEMO_KEY is set on the server, require it in
  // x-demo-key header. If unset, no gate (dev mode).
  const expectedKey = process.env.DEMO_KEY;
  if (expectedKey) {
    const provided = req.headers.get("x-demo-key");
    if (provided !== expectedKey) {
      return new Response(
        JSON.stringify({ error: "Demo access required" }),
        { status: 403 },
      );
    }
  }

  // Daily budget cap check.
  const status = budgetStatus();
  if (!status.allowed) {
    return new Response(
      JSON.stringify({
        error: `Daily demo cap of $${status.capUsd.toFixed(2)} reached. Already spent $${status.spentUsd.toFixed(4)} today. Try again tomorrow.`,
      }),
      { status: 429 },
    );
  }

  const body: SpawnRequest = await req.json();
  const { prompt, file, files, mode, role, memory, appMode } = body;

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
      let runCost = 0;
      const emit = (event: AgentEvent) => {
        if (event.type === "cost_update") {
          runCost = event.totalCost;
        }
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // stream closed
        }
      };

      try {
        await runAgentTree(prompt, allFiles, emit, abort.signal, mode, role, memory, appMode);
      } catch (err) {
        if (!abort.signal.aborted) {
          const msg = err instanceof Error ? err.message : "Engine failed";
          emit({ type: "agent_error", id: "root", error: msg });
        }
        emit({ type: "done" });
      }

      // Record this run's cost against the daily cap.
      recordCost(runCost);
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
