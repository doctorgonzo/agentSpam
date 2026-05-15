import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Clean single-Claude foil for the side-by-side comparison.
// NO system prompt, NO engineering. Same model as the Brain. Raw user
// prompt straight to messages.create. The whole point of this endpoint
// is to give the user's tree something honest to be measured against.
export async function POST(req: Request) {
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
