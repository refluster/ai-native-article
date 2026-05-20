// Mock + live workforce stats — shape consumed by Dashboard / KPIReadout /
// HeatStrip / LiveTrace. Mocks live in public/workforce-mock-stats.json
// and are used when WORKFORCE_AGENTS_API_BASE is not configured.

export type RunStatus = 'ok' | 'throw' | 'dlq';

export interface AgentMockStats {
  paused: boolean;
  archived: boolean;
  last_run_at: string;
  last_run_status: RunStatus;
  runs_this_month: number;
  cost_this_month_usd: number;
  deliv_count_total: number;
  next_run_at?: string;
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
