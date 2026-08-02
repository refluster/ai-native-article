#!/usr/bin/env node
// check-identity-drift.mjs — read-only sweep for persona identity drift
// (ML-014). Two checks over the live roster:
//
//   1. HEADER↔ROLE: every persona system_prompt opens with the convention
//      `# {Name} — {Title} — {Location}`. The {Title} segment must equal the
//      META row's `role` field. This is the drift class behind the
//      Founder/President gap on AGENT#maya (found 2026-07-06): `role` said
//      President while the prompt header (and body) still said Founder,
//      because the two fields have no shared source and no consistency
//      check at the write boundary. The write-time guard (S19 in
//      agent-config.ts) closes the boundary; this script audits the stock.
//
//   2. CROSS-REF (report-only heuristic): other personas' prompts often
//      restate a colleague's title inline — e.g. "You report to Maya
//      Okonkwo (San Francisco, President)". For every (prompt, colleague)
//      pair, if the prompt names the colleague with a parenthetical that
//      contains a *different* known role-ish string, flag it. These
//      references are denormalized by construction (seed-time copies), so
//      findings here are advisories for the next prompt bump, not errors.
//
// Usage:
//   node workforce/scripts/check-identity-drift.mjs [--stage prod] [--strict]
//
// Exit codes: 0 clean (or advisories only) · 1 header↔role drift found
//             (--strict: any finding) · 3 API unreachable.

import "../../scripts/lib/proxy-bootstrap.mjs";

const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const STRICT = process.argv.includes("--strict");

// `# Name — Title — Location` (em-dash separated). Prompts that don't follow
// the convention are skipped (reported as `no-header`), not failed — the
// convention is strong (33/33 at time of writing) but not a schema.
function headerTitle(prompt) {
  const first = (prompt || "").split(/\r?\n/, 1)[0] || "";
  const m = first.match(/^#\s+[^—]+—\s*([^—]+?)\s*—/);
  return m ? m[1].trim() : null;
}

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

let list;
try {
  list = await getJson("/agents");
} catch (e) {
  console.error(`check-identity-drift: agents API unreachable: ${e.message}`);
  process.exit(3);
}
const slugs = (list.items || []).filter((a) => !a.archived).map((a) => a.slug).sort();

const agents = [];
for (const slug of slugs) {
  agents.push(await getJson(`/agents/${slug}`));
}

let drift = 0;
let advisories = 0;

console.log(`check-identity-drift: ${agents.length} active persona(s)\n`);
console.log("── 1. system_prompt header title ↔ META.role ──");
for (const a of agents) {
  const t = headerTitle(a.system_prompt);
  if (t === null) {
    console.log(`  ?  ${a.slug}: no parseable "# Name — Title — Location" header (skipped)`);
    continue;
  }
  if (t !== (a.role || "").trim()) {
    drift++;
    console.log(`  ✗  ${a.slug}: header says "${t}" but role field says "${a.role}"`);
  }
}
if (drift === 0) console.log("  ✓ all headers match their role field");

console.log("\n── 2. cross-references in other personas' prompts (advisory) ──");
for (const a of agents) {
  const prompt = a.system_prompt || "";
  for (const b of agents) {
    if (b.slug === a.slug || !b.first_name) continue;
    const names = [
      `${b.first_name} ${b.last_name ?? ""}`.trim(),
      b.first_name,
    ];
    for (const name of names) {
      // "Name (anything)" — inspect the parenthetical for a stale title.
      const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(([^)]{0,120})\\)`, "g");
      let m;
      while ((m = re.exec(prompt)) !== null) {
        const paren = m[1];
        // Only flag when the parenthetical clearly carries a role-ish string
        // that is NOT the current role (locations alone are fine).
        const roleish = /(Founder|President|PM\b|Product Manager|VP\b|VP,|Director|Head of|Engineer|Designer|Researcher|Analyst|Counsel|Manager|Lead|Producer|Scriptwriter|Coordinator|Liaison)/;
        if (roleish.test(paren) && !paren.includes(b.role)) {
          advisories++;
          console.log(`  ~  ${a.slug}: refers to ${name} as "(${paren})" but ${b.slug}.role is "${b.role}"`);
        }
      }
      break; // full-name matched or not; avoid double-reporting via first name
    }
  }
}
if (advisories === 0) console.log("  ✓ no stale cross-references detected");

console.log(
  `\ncheck-identity-drift: ${drift} header↔role drift, ${advisories} cross-ref advisor${advisories === 1 ? "y" : "ies"}`,
);
process.exit(drift > 0 || (STRICT && advisories > 0) ? 1 : 0);
