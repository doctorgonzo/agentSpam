export type AppMode = "dev" | "demo";

export interface ModeConfig {
  maxDepth: number;
  maxAgents: number;
  rootFanout: string;
  managerFanout: string;
  workerFanout: string;
  fallbackSplitRoot: number;
  fallbackSplitChild: number;
  enableDebate: boolean;
  debateRounds: number;
}

export const MODES: Record<AppMode, ModeConfig> = {
  dev: {
    maxDepth: 3,
    maxAgents: 30,
    rootFanout: "4-5",
    managerFanout: "2-3",
    workerFanout: "2-3",
    fallbackSplitRoot: 3,
    fallbackSplitChild: 2,
    enableDebate: false,
    debateRounds: 0,
  },
  demo: {
    maxDepth: 5,
    maxAgents: 90,
    rootFanout: "5-6",
    managerFanout: "3-4",
    workerFanout: "3-4",
    fallbackSplitRoot: 4,
    fallbackSplitChild: 3,
    enableDebate: true,
    debateRounds: 3,
  },
};

// Read from NEXT_PUBLIC_AGENT_MODE env var so local can be "demo" via
// .env.local while prod defaults to "dev". Falls back to dev if unset.
const envMode = process.env.NEXT_PUBLIC_AGENT_MODE;
export const DEFAULT_MODE: AppMode = envMode === "demo" ? "demo" : "dev";

const config = { ...MODES[DEFAULT_MODE], mode: DEFAULT_MODE };

export function resolveConfig(override?: AppMode | null) {
  const m: AppMode = override ?? DEFAULT_MODE;
  return { ...MODES[m], mode: m };
}

export default config;
