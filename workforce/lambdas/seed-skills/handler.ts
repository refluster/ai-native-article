// wf-seed-skills Lambda handler.
//
// Reads workforce/skills/{name}/{SKILL.md, meta.json} from the deployed
// bundle (the Makefile builder copies the tree into ARTIFACTS_DIR/skills/)
// and registers SKILL#{name}/META rows in the workforce DDB table.
//
// ADR-0008: CREATE-ONLY. The row is authoritative for judgment-side fields
// after first seed (mutations flow through agents-api PATCH /skills/{name}),
// so existing rows are never overwritten — only new skill folders create.
//
// Invoked automatically by the wf-seed-skills-postdeploy-{stage}
// EventBridge rule on every successful stack CREATE/UPDATE. Operator
// can also invoke manually via `node workforce/scripts/seed-skills.mjs`.

import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getItem, putItem } from "../shared/ddb.js";
import type { SkillIdentity, SkillMetaRow } from "../shared/skill-row.js";
import { skillPk } from "../shared/skill-row.js";
import { skillIdentityHash } from "../shared/skill-identity-hash.js";
import type { SkillMeta } from "../shared/skill.js";

interface SeedResult {
  upserts: Array<{ name: string; action: "created" | "updated" | "noop" }>;
  errors: Array<{ name: string; message: string }>;
  scanned: number;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = process.env.SKILLS_ROOT ?? join(HERE, "skills");

export async function handler(): Promise<SeedResult> {
  const names = await listSkillDirs(SKILLS_ROOT);
  const result: SeedResult = { upserts: [], errors: [], scanned: names.length };

  for (const name of names) {
    try {
      const action = await seedOne(name);
      result.upserts.push({ name, action });
    } catch (err) {
      result.errors.push({
        name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(JSON.stringify({ event: "seed-skills-complete", result }));
  return result;
}

async function listSkillDirs(root: string): Promise<string[]> {
  const entries = await readdir(root);
  const dirs: string[] = [];
  for (const name of entries) {
    const s = await stat(join(root, name));
    if (s.isDirectory() && /^[a-z][a-z0-9-]*$/.test(name)) dirs.push(name);
  }
  return dirs.sort();
}

async function seedOne(name: string): Promise<"created" | "updated" | "noop"> {
  const dir = join(SKILLS_ROOT, name);
  const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as SkillMeta;
  if (meta.name !== name) {
    throw new Error(`meta.json:name "${meta.name}" does not match dir "${name}"`);
  }
  const skillMd = await readFile(join(dir, "SKILL.md"), "utf8");
  const { description, body } = splitFrontmatter(skillMd);

  const identity: SkillIdentity = {
    name: meta.name,
    version: meta.version,
    status: meta.status,
    deliverable: meta.deliverable,
    cost_class: meta.cost_class,
    owners: meta.owners,
    improvement_agent: meta.improvement_agent,
    created_at: meta.created_at,
    description,
    body,
  };
  const hash = skillIdentityHash(identity);

  const existing = await getItem<SkillMetaRow>(skillPk(name), "META");
  // ADR-0008 Decision §5: the seed is CREATE-ONLY. Judgment-side fields
  // (body / owners / status / …) are API-writable on the live row, so an
  // upsert from the git copy on the next deploy would silently revert
  // those edits — the exact two-master clobber ADR-0007 retired on the
  // agent side. An existing row is therefore never touched, regardless of
  // how the git folder has drifted; new skill folders still register here.
  if (existing) {
    return "noop";
  }

  const now = new Date().toISOString();
  const row: SkillMetaRow = {
    pk: skillPk(name),
    sk: "META",
    ...identity,
    invocations_this_month: 0,
    identity_hash: hash,
    updated_at: now,
  };
  await putItem(row);
  return "created";
}

function splitFrontmatter(raw: string): { description: string; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error("SKILL.md must begin with --- YAML frontmatter ---");
  let description = "";
  for (const line of m[1]!.split(/\r?\n/)) {
    if (!line.startsWith("description:")) continue;
    description = line.slice("description:".length).trim();
    if (description.startsWith('"') && description.endsWith('"')) {
      description = description.slice(1, -1);
    }
  }
  return { description, body: m[2]!.trim() };
}
