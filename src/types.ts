export type Task = {
  name: string;
  aiCapabilityScore: number; // 0-1 matches how well AI can do this
  humanCriticalityScore: number; // 0-1 matches human requirement (trust, empathy, etc)
};

export type Job = {
  id: string;
  title: string;
  cluster: string;
  employment: number; // Proxy for BLS volume
  automationCostIndex: number; // 0-1 (Higher = more expensive to automate)
  tasks: Task[];
};

export type JobStatus = {
  riskScore: number; // 0-1
  color: string; // Hex code or CSS color string
};
