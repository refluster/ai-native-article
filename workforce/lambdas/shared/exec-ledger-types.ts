// Minimal read shape of a PROJECT#{id}/EXEC#{ulid} ledger row (data-model.md).
export interface ExecLedgerRow {
  pk: string;
  sk: string;
  project_id: string;
  agent_slug: string;
  skill_name: string;
  started_at: string;
  status: "ok" | "throw" | "skipped" | "failed_artefact_redaction";
  summary?: string;
  error?: string;
}
