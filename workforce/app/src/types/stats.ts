// Mock + live workforce stats — shape consumed by Dashboard / KPIReadout /
// HeatStrip / LiveTrace. Mocks live in public/workforce-mock-stats.json
// and are used when WORKFORCE_AGENTS_API_BASE is not configured.

export type RunStatus = 'ok' | 'throw' | 'dlq';

/** Last-7-day rollup used for the per-agent performance panel. */
export interface AgentLast7d {
  runs_total: number;
  /** Run count keyed by skill name. */
  by_skill: Record<string, number>;
  deliv_count: number;
  /** Mean run duration in seconds across the window. */
  avg_duration_s: number;
  /** Fraction of runs that exited with status 'ok' (0..1). */
  ok_rate: number;
  /** Mean cost per run in USD across the window. */
  avg_cost_usd?: number;
}

/** One historical run surfaced on the agent profile. */
export interface AgentRunEntry {
  started_at: string;
  skill: string;
  duration_s: number;
  status: RunStatus;
  /** Free-text note (LLM throw message, op notes, etc.). */
  note?: string;
  /** Optional deliverable produced by this run. */
  deliverable?: {
    type: 'article' | 'plan' | 'design-doc' | 'launch-plan' | 'pr' | 'notification';
    /** Display id — 8-char ULID prefix or PR number. */
    id: string;
    /** Outbound link to the artefact (Notion page, PR, S3 prefix). */
    url?: string;
  };
}

export interface AgentMockStats {
  paused: boolean;
  archived: boolean;
  last_run_at: string;
  last_run_status: RunStatus;
  runs_this_month: number;
  cost_this_month_usd: number;
  deliv_count_total: number;
  next_run_at?: string;
  last_7d?: AgentLast7d;
  recent_runs?: AgentRunEntry[];
}

export interface MockTotals {
  agents_running: number;
  agents_paused: number;
  agents_throwing: number;
  runs_this_month: number;
  cost_this_month_usd: number;
  deliv_count_this_month: number;
  budget_envelope_usd: number;
}

export interface MockActivity {
  days: string[];
  by_slug: Record<string, number[]>;
}

export interface MockRecentRun {
  slug: string;
  started_at: string;
  duration_s: number;
  status: RunStatus;
  skill: string;
  note?: string;
}

export interface WorkforceMockStats {
  generated_at: string;
  month: string;
  totals: MockTotals;
  agents: Record<string, AgentMockStats>;
  activity: MockActivity;
  recent_runs: MockRecentRun[];
}
