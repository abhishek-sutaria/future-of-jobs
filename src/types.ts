export type Task = {
  name: string;
  aiCapabilityScore: number; // 0-1 matches how well AI can do this
  humanCriticalityScore: number; // 0-1 matches human requirement (trust, empathy, etc)
  importance: number; // E.g., O*NET importance score
};

export type Job = {
  id: string;
  title: string;
  cluster: string;
  employment: number; // Proxy for BLS volume
  automationCostIndex: number; // 0-1 (Higher = more expensive to automate)
  projectedGrowth: number; // Percentage (e.g., 5.2)
  salaryVolatilityLabel: string; // e.g., "High", "Medium", "Low"
  humanResilienceLabel: string; // "Low", "Medium", "High"

  // Accuracy Metadata
  confidenceScore: number; // 0.0 to 1.0
  dataSources: string[];   // e.g. ["BLS-2024", "ONET-Weighted"]
  isAlias: boolean;        // True if we used a Proxy Job
  isEstimate?: boolean;    // Flag for hardcoded estimate
  isStale?: boolean;       // True if fresh BLS data failed to load

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

export type JobStatus = {
  riskScore: number; // 0-1
  color: string; // Hex code or CSS color string
};
