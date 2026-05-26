// wf-seed-agents Lambda handler.
//
// Reads workforce/agents/{slug}/agent.json + system.md from the deployed
// Lambda bundle and upserts AGENT#{slug}/META rows in the workforce DDB
// table. Identity fields are written from files; operational fields
// (paused, archived, budget override) are preserved if already present.
//
// Idempotent: a re-seed against an unchanged file set is a no-op
// (identity_hash equals stored value -> skip the write).

import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { AgentBinding, AgentIdentity, AgentMetaRow } from "../shared/agent.js";
import { agentPk } from "../shared/agent.js";
import { getItem, putItem } from "../shared/ddb.js";
import { identityHash } from "../shared/identity-hash.js";
import { ConditionalCheckFailedException } from "../shared/ddb.js";
import {
  addMember,
  create as createProject,
  selfProjectId,
} from "../shared/project.js";

// agent.json on disk uses `budget_monthly_usd` (no _default suffix); the
// DDB row splits identity defaults from operational overrides.
interface AgentJsonOnDisk {
  slug: string;
  first_name: string;
  last_name: string;
  residence: string;
  role: string;
  model: string;
  prompt_version: string;
  budget_monthly_usd: number;
  default_project: string;
  streams: AgentIdentity["streams"];
  bindings: AgentBinding[];
  owner_email: string | null;
  created_at: string;
}

interface SeedResult {
  upserts: Array<{ slug: string; action: "created" | "updated" | "noop" }>;
  errors: Array<{ slug: string; message: string }>;
  scanned: number;
}

const HERE = dirname(fileURLToPath(import.meta.url));
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
    prompt_version: cfg.prompt_version,
    budget_monthly_usd_default: cfg.budget_monthly_usd,
    default_project: cfg.default_project,
    streams: cfg.streams,
    bindings: cfg.bindings,
    created_at: cfg.created_at,
  };
  const hash = identityHash(identity, systemMd);

  const existing = await getItem<AgentMetaRow>(agentPk(slug), "META");
  if (existing && existing.identity_hash === hash) {
    // Catch-up: agents seeded before Story 1-B (#90) lack the
    // self/{slug} project row. `ensureSelfProject` is idempotent
    // (create() is race-safe via attribute_not_exists(pk); addMember()
    // preserves joined_at on active members). Cost is ~1 DDB read +
    // ≤1 write per agent per noop seed.
    await ensureSelfProject(slug);
    return "noop";
  }

  const now = new Date().toISOString();
  const row: AgentMetaRow = {
    pk: agentPk(slug),
    sk: "META",
    ...identity,
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

  // Epic-010 Story 1-B: auto-seed the agent's `self/{slug}` project +
  // membership row. Idempotent in two layers:
  //   - createProject() uses attribute_not_exists(pk); a concurrent
  //     writer winning the race throws CCF which we ignore.
  //   - addMember() preserves joined_at when the agent is already an
  //     active member (audit-preserving per PR #111 review).
  // `self/{slug}` membership intentionally re-adds even when a prior
  // operator revoked it — the agent's personal project is canonical
  // for its own observability artefacts and not gated by RBAC.
  await ensureSelfProject(slug);

  return existing ? "updated" : "created";
}

async function ensureSelfProject(slug: string): Promise<void> {
  const pid = selfProjectId(slug);
  try {
    await createProject({ project_id: pid, owner_agent: slug });
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    // Project already exists (this seeder, a previous run, or a concurrent
    // writer won the race). Idempotent: continue to membership step.
  }
  await addMember(pid, slug);
}
