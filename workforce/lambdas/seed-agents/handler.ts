// wf-seed-agents Lambda handler.
//
// Reads workforce/agents/{slug}/agent.json + system.md from the deployed
// Lambda bundle and upserts AGENT#{slug}/META rows in the workforce DDB
// table. Identity fields are written from files; operational fields
// (paused, archived, overrides) are preserved if already present.
//
// Idempotent: a re-seed against an unchanged file set is a no-op
// (identity_hash equals stored value -> skip the write).
//
// Triggered manually via `aws lambda invoke` until the post-deploy
// trigger lands in a follow-up PR (see RFC-007 Q1).

import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { AgentIdentity, AgentMetaRow } from "../shared/agent.js";
import { agentPk } from "../shared/agent.js";
import { getItem, putItem } from "../shared/ddb.js";
import { identityHash } from "../shared/identity-hash.js";

// Each agent.json file omits the runtime-only "_default" / "_override" split
// suffixes (the file fields are the defaults). Map file shape -> DDB row.
interface AgentJsonOnDisk {
  slug: string;
  first_name: string;
  last_name: string;
  residence: string;
  role: string;
  model: string;
  schedule_cron: string;
  schedule_note: string;
  prompt_version: string;
  budget_monthly_usd: number;
  skills: string[];
  default_project: string;
  streams: AgentIdentity["streams"];
  primary_deliverable_type: AgentIdentity["primary_deliverable_type"];
  primary_deliverable_kind: string;
  code_execution?: AgentIdentity["code_execution"];
  owner_email: string | null;
  created_at: string;
}

interface SeedResult {
  upserts: Array<{ slug: string; action: "created" | "updated" | "noop" }>;
  errors: Array<{ slug: string; message: string }>;
  scanned: number;
}

const HERE = dirname(fileURLToPath(import.meta.url));
// Lambda bundle layout: handler.js sits at the bundle root; we copy the
// agents/ tree alongside it during `sam build`. See the SAM template's
// CodeUri + the seed-agents/build.mjs script.
const AGENTS_ROOT = process.env.AGENTS_ROOT ?? join(HERE, "agents");

export async function handler(): Promise<SeedResult> {
  const slugDirs = await listAgentDirs(AGENTS_ROOT);
  const result: SeedResult = { upserts: [], errors: [], scanned: slugDirs.length };

  for (const slug of slugDirs) {
    try {
      const action = await seedOne(slug);
      result.upserts.push({ slug, action });
    } catch (err) {
      result.errors.push({
        slug,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(JSON.stringify({ event: "seed-complete", result }));
  return result;
}

async function listAgentDirs(root: string): Promise<string[]> {
  const entries = await readdir(root);
  const dirs: string[] = [];
  for (const name of entries) {
    const s = await stat(join(root, name));
    if (s.isDirectory() && /^[a-z]+$/.test(name)) dirs.push(name);
  }
  return dirs.sort();
}

async function seedOne(slug: string): Promise<"created" | "updated" | "noop"> {
  const dir = join(AGENTS_ROOT, slug);
  const cfg = JSON.parse(
    await readFile(join(dir, "agent.json"), "utf8"),
  ) as AgentJsonOnDisk;
  if (cfg.slug !== slug) {
    throw new Error(`agent.json:slug "${cfg.slug}" does not match dir "${slug}"`);
  }
  const systemMd = await readFile(join(dir, "system.md"), "utf8");

  const identity: AgentIdentity = {
    slug: cfg.slug,
    first_name: cfg.first_name,
    last_name: cfg.last_name,
    residence: cfg.residence,
    role: cfg.role,
    model: cfg.model,
    primary_deliverable_type: cfg.primary_deliverable_type,
    primary_deliverable_kind: cfg.primary_deliverable_kind,
    code_execution: cfg.code_execution,
    prompt_version: cfg.prompt_version,
    schedule_cron_default: cfg.schedule_cron,
    schedule_note: cfg.schedule_note,
    budget_monthly_usd_default: cfg.budget_monthly_usd,
    skills: cfg.skills,
    default_project: cfg.default_project,
    streams: cfg.streams,
    created_at: cfg.created_at,
  };
  const hash = identityHash(identity, systemMd);

  const existing = await getItem<AgentMetaRow>(agentPk(slug), "META");
  if (existing && existing.identity_hash === hash) {
    return "noop";
  }

  const now = new Date().toISOString();
  const row: AgentMetaRow = {
    pk: agentPk(slug),
    sk: "META",
    ...identity,
    // operational fields: preserve from existing row on update; default on create
    schedule_cron_override: existing?.schedule_cron_override,
    budget_monthly_usd_override: existing?.budget_monthly_usd_override,
    paused: existing?.paused ?? false,
    archived: existing?.archived ?? false,
    last_run_at: existing?.last_run_at,
    last_run_status: existing?.last_run_status,
    runs_this_month: existing?.runs_this_month ?? 0,
    cost_this_month_usd: existing?.cost_this_month_usd ?? 0,
    deliv_count_total: existing?.deliv_count_total ?? 0,
    identity_hash: hash,
    updated_at: now,
  };

  await putItem(row);
  return existing ? "updated" : "created";
}
