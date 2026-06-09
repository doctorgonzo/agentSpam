import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { budgetStatus, recordCost } from "@/lib/budget";
import { pingPresence } from "@/lib/presence";

export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Clean single-Claude foil for the side-by-side comparison.
// NO system prompt, NO engineering. Same model as the Brain. Raw user
// prompt straight to messages.create. The whole point of this endpoint
// is to give the user's tree something honest to be measured against.
export async function POST(req: Request) {
  // Anonymous requests allowed. Wrong-key requests blocked.
  const expectedKeys = (process.env.DEMO_KEY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const provided = req.headers.get("x-demo-key");
  const keyValid = !!provided && expectedKeys.includes(provided);
  if (expectedKeys.length > 0 && provided && !keyValid) {
    return new Response(JSON.stringify({ error: "Wrong demo key" }), {
      status: 403,
    });
  }
  // The solo call runs alongside whatever tree the user is running, so
  // charge it to the same bucket the tree uses.
  const solomode: "dev" | "demo" = keyValid ? "demo" : "dev";

  const status = budgetStatus(solomode);
  if (!status.allowed) {
    return new Response(
      JSON.stringify({
        error: `Daily ${solomode} cap of $${status.capUsd.toFixed(2)} reached. Try again tomorrow.`,
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

  // Fire-and-forget presence ping — single-Claude users should also show
  // up on the map. Same IP-hash scheme as /api/spawn.
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const sessionId = `spawn:${crypto.createHash("md5").update(ip).digest("hex").slice(0, 12)}`;
    const lat = parseFloat(req.headers.get("x-vercel-ip-latitude") ?? "");
    const lng = parseFloat(req.headers.get("x-vercel-ip-longitude") ?? "");
    const city = req.headers.get("x-vercel-ip-city");
    const country = req.headers.get("x-vercel-ip-country");
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      pingPresence({
        sessionId,
        lat,
        lng,
        city: city ? decodeURIComponent(city) : undefined,
        country: country || undefined,
      });
    }
  } catch {
    // never let presence break the solo call
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
    recordCost(inTok * (3 / 1e6) + outTok * (15 / 1e6), solomode);
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
