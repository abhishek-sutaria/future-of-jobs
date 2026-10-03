export type Task = {
  name: string;
  aiCapabilityScore: number; // 0-1 matches how well AI can do this
  humanCriticalityScore: number; // 0-1 matches human requirement (trust, empathy, etc)
  /** Uniform placeholder (3) — not real O*NET Importance; unused in scoring. */
  importance: number;
};

export type Job = {
  id: string;
  title: string;
  cluster: string;
  employment: number; // Proxy for BLS volume
  /** Mean of task AI capability scores (0–1). Higher = more automation risk / easier for GenAI. */
  automationCostIndex: number;
  projectedGrowth: number; // Percentage (e.g., 5.2)
  salaryVolatilityLabel: string; // Percentile label: Critical | High | Moderate | Stable (store.ts)
  humanResilienceLabel: string; // Percentile label: Future-Proof | High | At Risk (store.ts)

  // Accuracy Metadata
  confidenceScore: number; // Source coverage index (store formula), not a BLS accuracy metric
  dataSources: string[];   // e.g. ["BLS-2024", "ONET-Weighted"]
  isAlias: boolean;        // True if we used a Proxy Job
  isEstimate?: boolean;    // Flag for hardcoded estimate
  isStale?: boolean;       // Deprecated — always false. Published OES is canonical; not a live-fetch fallback.

  tasks: Task[];
  yearlyForecast?: {
    year: number;
    growthImpact: number; // e.g. -5.0 or +2.0
    reasoning: string;
  }[];
  locations?: {
    name: string;
    lat: number;
    lng: number;
    employment: number;
    lq: number;
  }[];
};
