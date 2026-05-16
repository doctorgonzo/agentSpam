// In-memory daily budget cap. Imperfect across multiple warm Vercel
// instances — if traffic spins up >1 region simultaneously, you can
// exceed the cap by a factor of the instance count. Good enough for
// a hackathon demo with low traffic. The real protection is at the
// Anthropic console (set a monthly hard cap there too).

interface Bucket {
  date: string;
  spentUsd: number;
}

let bucket: Bucket = { date: "", spentUsd: 0 };

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureFresh() {
  const t = todayStr();
  if (bucket.date !== t) {
    bucket = { date: t, spentUsd: 0 };
  }
}

export const DAILY_CAP_USD = parseFloat(process.env.DAILY_CAP_USD ?? "0.60");

export function budgetStatus(): {
  allowed: boolean;
  spentUsd: number;
  capUsd: number;
} {
  ensureFresh();
  return {
    allowed: bucket.spentUsd < DAILY_CAP_USD,
    spentUsd: bucket.spentUsd,
    capUsd: DAILY_CAP_USD,
  };
}

export function recordCost(usd: number) {
  if (!Number.isFinite(usd) || usd <= 0) return;
  ensureFresh();
  bucket.spentUsd += usd;
}
