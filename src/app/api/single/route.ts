import Anthropic from "@anthropic-ai/sdk";
import { budgetStatus, recordCost } from "@/lib/budget";

export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Clean single-Claude foil for the side-by-side comparison.
// NO system prompt, NO engineering. Same model as the Brain. Raw user
// prompt straight to messages.create. The whole point of this endpoint
// is to give the user's tree something honest to be measured against.
export async function POST(req: Request) {
  // Demo token gate.
  const expectedKey = process.env.DEMO_KEY;
  if (expectedKey) {
    const provided = req.headers.get("x-demo-key");
    if (provided !== expectedKey) {
      return new Response(JSON.stringify({ error: "Demo access required" }), {
        status: 403,
      });
    }
  }

  // Daily budget cap.
  const status = budgetStatus();
  if (!status.allowed) {
    return new Response(
      JSON.stringify({
        error: `Daily demo cap of $${status.capUsd.toFixed(2)} reached. Try again tomorrow.`,
      }),
      { status: 429 },
    );
  }

  const body = await req.json();
  const { prompt } = body;
  if (!prompt || typeof prompt !== "string") {
    return new Response(JSON.stringify({ error: "Need a prompt" }), {
      status: 400,
    });
  }

  const startedAt = Date.now();
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
    // Record cost using sonnet-4-6 pricing.
    const inTok = response.usage?.input_tokens ?? 0;
    const outTok = response.usage?.output_tokens ?? 0;
    recordCost(inTok * (3 / 1e6) + outTok * (15 / 1e6));
    return new Response(
      JSON.stringify({
        text,
        elapsedMs: Date.now() - startedAt,
        model: "claude-sonnet-4-6",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "API error";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
