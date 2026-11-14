// wf-config-digest — the ADR-0007 weekly agent-config review digest.
//
// Decision §5: with agent config single-sourced in DDB and writes reviewed
// post-hoc, the weekly digest IS the review surface. EventBridge fires this
// weekly (Mon 00:30 UTC); it:
//
//   1. compiles the week's AGENT#{slug}/AUDIT# items (actor + field-level
//      diffs, written by agents-api on every config mutation) into a
//      markdown summary, grouped by agent;
//   2. delivers it as a GitHub issue (the ADR's default delivery surface)
//      labelled project:workforce / layer:L3 / type:ops;
//   3. kicks the Decision §7 durability leg: ExportTableToPointInTime to
//      the existing wf bucket under exports/ (PITR is enabled on the table
//      by the same PR that ships this function). Git no longer reconstructs
//      the org, so environment rebuild = restore from these, not re-seed.
//
// Fail-loud contract (Decision §5): every leg throws on failure — a week
// WITH mutations but WITHOUT a delivered digest surfaces on the function's
// Errors alarm, and a silent scheduling lapse surfaces on the missed-run
// alarm (Invocations < 1 over 8 days). A quiet week (zero mutations) skips
// the issue — the export still runs — and emits WfConfigDigestEmpty so
// "quiet" and "broken" are distinguishable.

import {
  DynamoDBClient,
  ExportTableToPointInTimeCommand,
} from "@aws-sdk/client-dynamodb";

import { type AgentMetaRow, agentPk } from "../shared/agent.js";
import {
  AUDIT_SK_PREFIX,
  type AgentAuditChange,
  type AgentAuditRow,
  type TruncatedAuditValue,
} from "../shared/agent-audit.js";
import { type SkillMetaRow, skillPk } from "../shared/skill-row.js";
import { type SkillAuditRow } from "../shared/skill-audit.js";
import { queryBySkPrefix, scanPrefix } from "../shared/ddb.js";
import { createIssue } from "../shared/github.js";

// ── org-graph validation (FU-022) ─────────────────────────────────────────

export interface OrgViolation {
  kind: "cycle" | "dangling";
  slug: string;
  field: "reports_to" | "lateral";
  edge: string;
  /** Closed path for cycle violations: [a, b, …, a]. */
  cycle_path?: readonly string[];
}

/**
 * Checks the live agent roster for org-graph inconsistencies:
 * - dangling edges in `reports_to` or `lateral` (target slug not in roster)
 * - cycles in `reports_to` (would cause computeDepths to throw at deploy time)
 *
 * The roster is the NON-ARCHIVED agents only — the same set the deploy gate
 * sees (`GET /agents` filters `archived`; agents-api/handler.ts). An active
 * agent whose edge names an archived agent is therefore `dangling`, exactly
 * as `build-agent-manifest.mjs` will treat it; archived agents' own edges are
 * not checked because they never reach the manifest.
 *
 * Surfacing these in the weekly digest catches broken graphs before
 * deploy-article-site.yml trips on them (see FU-022).
 */
export function checkOrgGraph(agents: ReadonlyMap<string, AgentMetaRow>): OrgViolation[] {
  const violations: OrgViolation[] = [];
  const active = new Map<string, AgentMetaRow>();
  for (const [slug, meta] of agents) {
    if (!meta.archived) active.set(slug, meta);
  }
  agents = active;
  const slugs = new Set(agents.keys());

  // ── dangling edges ───────────────────────────────────────────────────────
  for (const [slug, meta] of agents) {
    for (const target of meta.reports_to ?? []) {
      if (!slugs.has(target)) {
        violations.push({ kind: "dangling", slug, field: "reports_to", edge: target });
      }
    }
    for (const target of meta.lateral ?? []) {
      if (!slugs.has(target)) {
        violations.push({ kind: "dangling", slug, field: "lateral", edge: target });
      }
    }
  }

  // ── cycles in reports_to ─────────────────────────────────────────────────
  // Standard DFS coloring. Only reports_to is a directed hierarchy; lateral
  // edges are intentionally bidirectional and not checked for cycles.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const s of slugs) color.set(s, WHITE);
  const reported = new Set<string>();
  const pathStack: string[] = [];

  function visit(slug: string): void {
    color.set(slug, GRAY);
    pathStack.push(slug);
    for (const target of agents.get(slug)?.reports_to ?? []) {
      if (!slugs.has(target)) continue; // dangling already reported above
      if (color.get(target) === GRAY) {
        const cycleStart = pathStack.indexOf(target);
        const path = [...pathStack.slice(cycleStart), target];
        const id = [...path].sort().join("\0");
        if (!reported.has(id)) {
          reported.add(id);
          violations.push({ kind: "cycle", slug, field: "reports_to", edge: target, cycle_path: path });
        }
      } else if (color.get(target) === WHITE) {
        visit(target);
      }
    }
    pathStack.pop();
    color.set(slug, BLACK);
  }

  for (const s of slugs) {
    if (color.get(s) === WHITE) visit(s);
  }

  return violations;
}

const STAGE = process.env.STAGE ?? "dev";
const WINDOW_DAYS = 7;
// Per-partition read ceiling. The audit partition gains a handful of items
// per week at single-operator scale; 500 bounds a pathological burst while
// staying one Query page.
const AUDIT_PAGE_LIMIT = 500;

const GITHUB_OWNER = process.env.WF_GITHUB_OWNER ?? "refluster";
const GITHUB_REPO = process.env.WF_GITHUB_REPO ?? "ai-native-article";
const DIGEST_LABELS = ["project:workforce", "layer:L3", "type:ops"] as const;

// Raw (non-document) client: ExportTableToPointInTime is a control-plane
// call the document client does not wrap.
const rawDdb = new DynamoDBClient({});

export interface ConfigDigestResult {
  status: "delivered" | "empty";
  window_from: string;
  window_to: string;
  agents_changed: number;
  skills_changed: number;
  mutations: number;
  org_violations: number;
  issue_url?: string;
  export_arn?: string;
}

export async function handler(): Promise<ConfigDigestResult> {
  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  // ── 1. collect the week's audit items, grouped by agent ───────────────
  // Also capture the full AgentMetaRow for org-graph validation (FU-022).
  const byAgent = new Map<string, AgentAuditRow[]>();
  const allAgentMetas = new Map<string, AgentMetaRow>();
  let cursor: string | undefined;
  do {
    const page = await scanPrefix<AgentMetaRow>("AGENT#", "META", 100, cursor);
    for (const meta of page.items) {
      allAgentMetas.set(meta.slug, meta);
      const audits = await queryBySkPrefix<AgentAuditRow>(
        agentPk(meta.slug),
        AUDIT_SK_PREFIX,
        AUDIT_PAGE_LIMIT,
        false, // newest-first; the window filter below trims the tail
      );
      // A full page means the window MAY extend past what we fetched — a
      // digest that silently omits mutations is worse than no digest
      // (C-4), so refuse to deliver a possibly-partial one. At
      // single-operator scale this never trips; if it does, paginate
      // before raising the limit.
      if (audits.length >= AUDIT_PAGE_LIMIT) {
        throw new Error(
          `config-digest: AGENT#${meta.slug} audit partition returned a full page (${AUDIT_PAGE_LIMIT}); cannot prove window completeness — paginate the audit query`,
        );
      }
      const inWindow = audits
        .filter((a) => a.at >= fromIso && a.at <= toIso)
        .sort((a, b) => (a.at < b.at ? -1 : 1));
      if (inWindow.length > 0) byAgent.set(meta.slug, inWindow);
    }
    cursor = page.cursor;
  } while (cursor);

  // ── 1b. the week's skill audits (ADR-0008 §4) — same shape, SKILL# pk ──
  const bySkill = new Map<string, SkillAuditRow[]>();
  let skillCursor: string | undefined;
  do {
    const page = await scanPrefix<SkillMetaRow>("SKILL#", "META", 100, skillCursor);
    for (const meta of page.items) {
      const audits = await queryBySkPrefix<SkillAuditRow>(
        skillPk(meta.name),
        AUDIT_SK_PREFIX,
        AUDIT_PAGE_LIMIT,
        false,
      );
      if (audits.length >= AUDIT_PAGE_LIMIT) {
        throw new Error(
          `config-digest: SKILL#${meta.name} audit partition returned a full page (${AUDIT_PAGE_LIMIT}); cannot prove window completeness — paginate the audit query`,
        );
      }
      const inWindow = audits
        .filter((a) => a.at >= fromIso && a.at <= toIso)
        .sort((a, b) => (a.at < b.at ? -1 : 1));
      if (inWindow.length > 0) bySkill.set(meta.name, inWindow);
    }
    skillCursor = page.cursor;
  } while (skillCursor);

  const mutations =
    [...byAgent.values()].reduce((n, rows) => n + rows.length, 0) +
    [...bySkill.values()].reduce((n, rows) => n + rows.length, 0);

  // ── 1c. org-graph validation (FU-022) ─────────────────────────────────
  const orgViolations = checkOrgGraph(allAgentMetas);

  // ── 2. durability export (Decision §7) — runs on quiet weeks too ──────
  const exportArn = await exportTable(toIso);

  // ── 3. deliver ─────────────────────────────────────────────────────────
  if (mutations === 0 && orgViolations.length === 0) {
    console.log(
      JSON.stringify({ event: "config_digest_empty", from: fromIso, to: toIso, export_arn: exportArn }),
    );
    return {
      status: "empty",
      window_from: fromIso,
      window_to: toIso,
      agents_changed: 0,
      skills_changed: 0,
      mutations: 0,
      org_violations: 0,
      export_arn: exportArn,
    };
  }

  // Prepend ⚠️ when org violations are present so the issue stands out in
  // the GitHub issues list (the operator should fix these before next deploy).
  const violationPrefix = orgViolations.length > 0 ? "⚠️ " : "";
  const title = `${violationPrefix}Weekly config digest — ${fromIso.slice(0, 10)} → ${toIso.slice(0, 10)}`;
  const body = renderDigest(byAgent, bySkill, fromIso, toIso, exportArn, orgViolations);
  const issue = await createIssue({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    title,
    body,
    labels: DIGEST_LABELS,
  });

  console.log(
    JSON.stringify({
      event: "config_digest_delivered",
      from: fromIso,
      to: toIso,
      agents_changed: byAgent.size,
      skills_changed: bySkill.size,
      mutations,
      org_violations: orgViolations.length,
      issue_url: issue.url,
    }),
  );
  return {
    status: "delivered",
    window_from: fromIso,
    window_to: toIso,
    agents_changed: byAgent.size,
    skills_changed: bySkill.size,
    mutations,
    org_violations: orgViolations.length,
    issue_url: issue.url,
    export_arn: exportArn,
  };
}

async function exportTable(toIso: string): Promise<string> {
  const tableArn = process.env.TABLE_ARN;
  const bucket = process.env.BUCKET_NAME;
  if (!tableArn || !bucket) {
    throw new Error("config-digest: TABLE_ARN and BUCKET_NAME env vars are required");
  }
  const res = await rawDdb.send(
    new ExportTableToPointInTimeCommand({
      TableArn: tableArn,
      S3Bucket: bucket,
      S3Prefix: `exports/${STAGE}/${toIso.slice(0, 10)}`,
      ExportFormat: "DYNAMODB_JSON",
    }),
  );
  const arn = res.ExportDescription?.ExportArn;
  if (!arn) throw new Error("config-digest: export started but no ExportArn returned");
  return arn;
}

// ── rendering ─────────────────────────────────────────────────────────────

function isTruncated(v: unknown): v is TruncatedAuditValue {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { truncated?: unknown }).truncated === true &&
    typeof (v as { sha256?: unknown }).sha256 === "string"
  );
}

/** One side of a diff, rendered for the issue body. Digested long strings
 *  (the system_prompt case) must stay legible — the ADR names illegible
 *  prompt diffs as the way the W-5 discipline degrades in practice. */
export function renderValue(v: unknown): string {
  if (isTruncated(v)) {
    return `_(${v.length.toLocaleString("en-US")} chars, sha256 \`${v.sha256.slice(0, 12)}…\`)_ “${v.head.slice(0, 80)}…”`;
  }
  if (v === null) return "_(unset)_";
  if (typeof v === "string") return `\`${v}\``;
  const json = JSON.stringify(v);
  return json.length > 200 ? `\`${json.slice(0, 200)}…\`` : `\`${json}\``;
}

function renderChange(c: AgentAuditChange): string {
  return `  - **${c.field}**: ${renderValue(c.before)} → ${renderValue(c.after)}`;
}

function renderOrgViolations(violations: readonly OrgViolation[]): string {
  const blocking = violations.filter((v) => v.field === "reports_to");
  const advisory = violations.filter((v) => v.field === "lateral");
  const lines: string[] = ["## ⚠️ Org-graph violations", ""];
  if (blocking.length > 0) {
    lines.push(
      "The following `reports_to` edges are inconsistent with the live",
      "(non-archived) agent roster. `deploy-article-site.yml` will reject the",
      "manifest until these are corrected via `PATCH /agents/{slug}` through",
      "agents-api.",
      "",
    );
    for (const v of blocking) lines.push(renderViolationLine(v));
    lines.push("");
  }
  if (advisory.length > 0) {
    lines.push(
      "Advisory — `lateral` edges that name a slug missing from the roster.",
      "These do not by themselves fail the deploy gate; fix them to keep the",
      "org graph honest.",
      "",
    );
    for (const v of advisory) lines.push(renderViolationLine(v));
    lines.push("");
  }
  return lines.join("\n");
}

function renderViolationLine(v: OrgViolation): string {
  if (v.kind === "dangling") {
    return (
      `- **dangling** \`${v.slug}.${v.field}\` → \`${v.edge}\` ` +
      `(target is not an active agent in the roster)`
    );
  }
  const path = v.cycle_path ? v.cycle_path.join(" → ") : `${v.slug} → ${v.edge}`;
  return `- **cycle** in \`reports_to\`: ${path}`;
}

export function renderDigest(
  byAgent: ReadonlyMap<string, readonly AgentAuditRow[]>,
  bySkill: ReadonlyMap<string, readonly SkillAuditRow[]>,
  fromIso: string,
  toIso: string,
  exportArn: string,
  orgViolations: readonly OrgViolation[] = [],
): string {
  const lines: string[] = [
    `Weekly config review (agents: ADR-0007 §5; skills: ADR-0008 §4). Window: \`${fromIso}\` → \`${toIso}\`.`,
    "",
    "Every entry below is a config mutation written through agents-api and",
    "validated by the write-time guards; this digest is the post-hoc human",
    "review. Reply on this issue (or PATCH a correction) if anything looks",
    "wrong — closing it records the review as done.",
    "",
  ];
  if (orgViolations.length > 0) {
    lines.push(renderOrgViolations(orgViolations));
  }
  const slugs = [...byAgent.keys()].sort();
  for (const slug of slugs) {
    const rows = byAgent.get(slug)!;
    lines.push(`## ${slug} — ${rows.length} mutation(s)`);
    lines.push("");
    for (const row of rows) {
      lines.push(`- \`${row.at}\` · ${row.kind} · actor \`${shortActor(row.actor)}\``);
      for (const c of row.changes) lines.push(renderChange(c));
    }
    lines.push("");
  }
  const skillNames = [...bySkill.keys()].sort();
  for (const name of skillNames) {
    const rows = bySkill.get(name)!;
    lines.push(`## skill:${name} — ${rows.length} mutation(s)`);
    lines.push("");
    for (const row of rows) {
      lines.push(`- \`${row.at}\` · ${row.kind} · actor \`${shortActor(row.actor)}\``);
      for (const c of row.changes) lines.push(renderChange(c));
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(`Durability export (Decision §7): \`${exportArn}\``);
  return lines.join("\n");
}

function shortActor(actor: string): string {
  // "arn:aws:iam::123:user/operator" → "user/operator"; non-ARN actors pass through.
  const m = /^arn:aws:[^:]+::\d+:(.+)$/.exec(actor);
  return m?.[1] ?? actor;
}
