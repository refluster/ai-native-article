// Workforce project types — mirrors the wf-agents-api `/projects` response
// shapes. The backend definitions live at workforce/lambdas/agents-api/
// handler.ts (Epic-010 §10) and workforce/lambdas/shared/project.ts (the
// row shapes). Keep this file in sync with the API response when the
// shape evolves; the SPA does not import from the Lambda tree directly
// because the two TS projects compile under different module/target
// configurations.
//
// Project ids may contain `/` (e.g. `self/ren`) — the SPA must
// encodeURIComponent any id segment before placing it in a URL path
// (handled by lib/projects.ts).

export type ProjectStatus = 'active' | 'archived';

// Mirrors `ExecStatus` in workforce/lambdas/shared/project.ts. Story 3
// (#92, merged) added the `failed_artefact_redaction` variant for the
// case where the redaction guard blocked an artefact write — the
// execution row still lands, but the artefact is intentionally absent.
// StatusBadge in components/StatusBadge.tsx renders each value.
export type ExecStatus = 'ok' | 'throw' | 'skipped' | 'failed_artefact_redaction';

/** Shape of one row in `GET /projects`. */
export interface ProjectSummary {
  project_id: string;
  status: ProjectStatus;
  /** Either an agent slug (e.g. "ren") or the literal `_operator`. */
  owner_agent: string;
  created_at: string;
  archived_at?: string;
  /** Count of active (non-revoked) MEMBER rows. */
  member_count?: number;
  /** Most-recent EXEC#* started_at on this project's partition. */
  last_execution_at?: string;
}

/** Shape of `GET /projects/{id}` — same as ProjectSummary today. */
export type ProjectDetail = ProjectSummary;

/** One row in `GET /projects/{id}/members`. */
export interface ProjectMember {
  agent_slug: string;
  joined_at: string;
  /** Present only when `?include_revoked=true` and the row is revoked. */
  revoked_at?: string;
}

/** One row in `GET /projects/{id}/executions`. */
export interface ProjectExecution {
  exec_ulid: string;
  project_id: string;
  agent_slug: string;
  skill_name: string;
  skill_version: string;
  started_at: string;
  ended_at: string;
  status: ExecStatus;
  used_credential_types?: string[];
  artifact_ref?: {
    uri: string;
    content_hash: string;
    content_type: string;
    size_bytes: number;
    summary: string;
  };
  error?: string;
}

/** One row in `GET /agents/{slug}/projects` — the agent's memberships. */
export interface AgentMembership {
  project_id: string;
  joined_at: string;
}

/** Static fallback shape served from /workforce-projects-mock.json
 *  when the live API isn't wired (epic-010 §200). */
export interface WorkforceProjectsMock {
  generated_at: string;
  projects: ProjectSummary[];
  members: Record<string, ProjectMember[]>;
  executions: Record<string, ProjectExecution[]>;
  /** agent_slug → memberships. */
  agent_memberships: Record<string, AgentMembership[]>;
}
