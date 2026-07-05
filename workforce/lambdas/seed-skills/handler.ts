// wf-seed-skills Lambda handler.
//
// Reads workforce/skills/{name}/{SKILL.md, meta.json} from the deployed
// bundle (the Makefile builder copies the tree into ARTIFACTS_DIR/skills/)
// and registers SKILL#{name}/META rows in the workforce DDB table.
//
// ADR-0018 (supersedes ADR-0008 Decision §5): the seed is VERSION-GATED, not
// flat create-only. New skill folders create. For an EXISTING row, the git
// judgment-side fields (body/description/status/owners/cost_class/
// improvement_agent) are synced ONLY when the git meta.json:version is
// strictly newer than the live row's version — an intentional version bump is
// the propagation trigger. An equal-or-older git version never overwrites the
// row, so a live agents-api PATCH that bumps the version above git stays
// authoritative (the two-master clobber ADR-0008 retired is still avoided —
// it is now gated by version instead of blanket-forbidden). Every accepted
// sync appends a SKILL#{name}/AUDIT# item (ADR-0008 §4). `deliverable` remains
// git-authoritative and is reconciled on every seed regardless of version.
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
import { appendSkillAudit } from "../shared/skill-audit.js";
import { diffChanges } from "../shared/agent-audit.js";

interface SeedResult {
  upserts: Array<{ name: string; action: "created" | "updated" | "noop" }>;
  errors: Array<{ name: string; message: string }>;
  scanned: number;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** The actor recorded on seed-driven audit rows, distinct from the
 *  "operator"/IAM-ARN actors the agents-api PATCH path records. */
const SEED_ACTOR = "wf-seed-skills";

/** Compare two semver strings. Returns >0 if `a` is newer than `b`, 0 if
 *  equal, <0 if older. A non-semver string parses as 0.0.0, so a malformed
 *  git version can never win the version gate (fails safe: no sync). */
export function compareSemver(a: string, b: string): number {
  const parse = (s: string): [number, number, number] => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(s).trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  return aMaj - bMaj || aMin - bMin || aPat - bPat;
}

export async function handler(): Promise<SeedResult> {
  const skillsRoot = process.env.SKILLS_ROOT ?? join(HERE, "skills");
  const names = await listSkillDirs(skillsRoot);
  const result: SeedResult = { upserts: [], errors: [], scanned: names.length };

  for (const name of names) {
    try {
      const action = await seedOne(name, skillsRoot);
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

async function seedOne(
  name: string,
  root: string,
): Promise<"created" | "updated" | "noop"> {
  const dir = join(root, name);
  const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as SkillMeta;
  if (meta.name !== name) {
    throw new Error(`meta.json:name "${meta.name}" does not match dir "${name}"`);
  }
  const skillMd = await readFile(join(dir, "SKILL.md"), "utf8");
  const { description, body } = splitFrontmatter(skillMd);

  const identity: SkillIdentity = {
    name: meta.name,
    display_name: meta.display_name,
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

  if (existing) {
    // ADR-0018: version-gated sync of the judgment-side fields. Only a git
    // version STRICTLY newer than the live row propagates — an equal-or-older
    // version leaves API edits intact (no blind clobber). The judgment-side
    // fields authored in git (body/description/status/owners/cost_class/
    // improvement_agent) are the ones the agents-api PATCH path also writes.
    if (compareSemver(meta.version, existing.version) > 0) {
      // Preserve computed (invocations_this_month/last_invoked_at) and
      // operational (improvement_agent_override) state and the immutable
      // created_at from the live row; overwrite the authored fields from git.
      const authored = {
        version: meta.version,
        status: meta.status,
        cost_class: meta.cost_class,
        owners: meta.owners,
        improvement_agent: meta.improvement_agent,
        description,
        body,
        deliverable: meta.deliverable,
      };
      const synced: SkillMetaRow = {
        ...existing,
        ...authored,
        identity_hash: hash,
        updated_at: new Date().toISOString(),
      };
      await putItem(synced);
      // Audit AFTER the row write, THROW on failure (W-4) — the same ordering
      // the agents-api PATCH path uses, so wf-config-digest renders seed-driven
      // and API-driven skill mutations through one path. diffChanges records
      // only the fields that actually moved (long bodies digested, not stored).
      const changes = diffChanges(
        existing as unknown as Record<string, unknown>,
        authored,
      );
      if (changes.length > 0) {
        await appendSkillAudit(name, SEED_ACTOR, changes);
      }
      return "updated";
    }

    // git version not newer: keep ADR-0008's deliverable-only reconciliation.
    // `deliverable` is git-authoritative (PATCH /skills rejects it), so the
    // seed is the correct master writing its own field even without a bump.
    if (JSON.stringify(existing.deliverable) !== JSON.stringify(meta.deliverable)) {
      await putItem({
        ...existing,
        deliverable: meta.deliverable,
        updated_at: new Date().toISOString(),
      });
      return "updated";
    }
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
