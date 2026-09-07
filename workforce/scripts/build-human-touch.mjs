#!/usr/bin/env node
/**
 * build-human-touch.mjs — Epic-020 Story 2: the monthly human-leverage
 * aggregation. Replays one calendar month of human touches into the per-class
 * tables defined by the Epic-016 § "Human-touch taxonomy (Epic-020 Story 1)"
 * block, and publishes them to `PERF#{scope}/HUMAN-TOUCH` for the existing
 * /performance surface (R-N2: no new store, no new service, no new credential
 * type).
 *
 * The taxonomy is the authority on *which* touch types exist and how each is
 * classed; this script is only the collector + the arithmetic. Adding or
 * re-classing a type is a taxonomy edit first — see TOUCH_TYPES below, which
 * mirrors that table and carries its version.
 *
 * Sources, per the taxonomy's "source of record" column:
 *   T1/T2  GitHub PR metadata (the project PAT) — operator terminal action on
 *          a labelled PR, split from delegated R-N10 merges by the
 *          `autopilot:needs-human` + `autopilot:reason:*` labels (Trap 2:
 *          `merged_by` is NOT admissible, because a delegated merge executes
 *          through the project PAT and renders as the operator).
 *   T3     Notion gate flips — `estimated` until the write-time event row of
 *          Trap 1 exists, so it contributes to no count and is excluded from
 *          the falsifier denominator.
 *   T4     `AUDIT#` rows in DDB.
 *   T5     the W-3 amendment table in workforce/docs/governance.md.
 *   T6     epic `Status` flips to Accepted, read from git history — matching
 *          BOTH authored forms, because an aggregator written against the
 *          dashed form alone silently returns zero for epic-018.
 *   T7     hire-round docs under workforce/docs/hires/ and their adding commit.
 *
 * **An unreachable source reports `touches: null`, never 0.** A zero would be
 * a scope statement wearing a reading's clothes; the aggregation excludes
 * nulls from every sum and names them in `coverage.missing`, and the run exits
 * non-zero when the epic's ≥80% countable bar is missed. Same discipline as
 * build-repo-performance.mjs's loud project skips.
 *
 * Usage:
 *   node workforce/scripts/build-human-touch.mjs --month 2026-07 [--dry-run]
 *     [--publish-ddb]      # upsert PERF#{scope}/HUMAN-TOUCH
 *     [--table NAME]       # DDB table (default: $TABLE_NAME or wf-table-prod)
 *     [--region us-west-2]
 *     [--repo owner/name]  # GitHub repo for T1/T2 (default: refluster/ai-native-article)
 *
 * Default is --dry-run (prints the block as JSON). GITHUB_TOKEN supplies the
 * PAT for T1/T2; without it those two types report unavailable rather than
 * silently counting zero.
 */

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { aggregateHumanTouches } from "./lib/human-touch-aggregate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Version of the Epic-016 taxonomy block this script mirrors. Bump in the
 *  same PR that bumps the taxonomy — a table scored under v1 is not
 *  comparable to one scored under v2. */
export const TAXONOMY_VERSION = "v1";

/** The taxonomy table, mirrored. `unit` names the closed work-unit
 *  enumeration each type credits. */
export const TOUCH_TYPES = [
  { type: "T1", class: "gate", designation: "counted", unit: "changed-file", label: "Operator terminal action on a labelled PR (merge or close)" },
  { type: "T2", class: "gate", designation: "counted", unit: "pr", label: "Operator verdict on an autopilot:needs-human escalation" },
  { type: "T3", class: "gate", designation: "estimated", unit: "pipeline-stage", label: "Podcast approval-gate flip (script-ready → approved)" },
  { type: "T4", class: "digest", designation: "counted", unit: "audit-mutation", label: "Weekly config digest review" },
  { type: "T5", class: "one-time", designation: "counted", unit: "usd-headroom", label: "W-3 cost-cap amendment" },
  { type: "T6", class: "gate", designation: "counted", unit: "referenced-story", label: "Epic status flip (Draft → Accepted)" },
  { type: "T7", class: "one-time", designation: "counted", unit: "persona", label: "Hire-round sign-off" },
];

const meta = (id) => TOUCH_TYPES.find((t) => t.type === id);

/** Build one result row. `touches: null` ⇒ unavailable, and `work_units`
 *  follows it to null so the two can never disagree. */
export function result(id, { touches, workUnits = 0, ambiguous = 0, unavailableReason }) {
  const m = meta(id);
  const unavailable = touches === null;
  return {
    type: m.type,
    label: m.label,
    class: m.class,
    designation: m.designation,
    unit: m.unit,
    touches: unavailable ? null : touches,
    work_units: unavailable ? null : workUnits,
    ambiguous,
    ...(unavailable ? { unavailable_reason: unavailableReason ?? "source unreadable" } : {}),
  };
}

// ── window ────────────────────────────────────────────────────────────────

/** Calendar-month bounds, UTC, end-exclusive at the next month's first day. */
export function monthWindow(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`--month must be YYYY-MM, got "${month}"`);
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01T00:00:00Z`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const end = `${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00Z`;
  return { start, end };
}

const inWindow = (iso, w) => typeof iso === "string" && iso >= w.start && iso < w.end;

// ── T5 — the W-3 amendment table ──────────────────────────────────────────

/** Parse the amendment table out of governance.md. Rows look like
 *  `| 2026-08-06 | 500 → 600 | ...trigger... |` (leading whitespace allowed,
 *  the table is nested under the W-3 bullet). Work units = USD headroom
 *  released, which is why T5 carries its own unit. */
export function parseW3Amendments(md) {
  const rows = [];
  for (const line of md.split("\n")) {
    const m = /^\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\d+)\s*(?:→|->)\s*(\d+)\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
    if (!m) continue;
    rows.push({ date: m[1], from: Number(m[2]), to: Number(m[3]), trigger: m[4] });
  }
  return rows;
}

export function collectT5(md, w) {
  const hits = parseW3Amendments(md).filter((r) => inWindow(`${r.date}T00:00:00Z`, w));
  return result("T5", {
    touches: hits.length,
    workUnits: hits.reduce((n, r) => n + (r.to - r.from), 0),
  });
}

// ── T6 — epic status flips, both authored forms ───────────────────────────

/** Both forms the taxonomy names. An aggregator written against the dashed
 *  form alone returns zero T6 touches for epic-018 and reports that as "no
 *  status flip", which is indistinguishable from the truth. */
const STATUS_FORMS = [/^- \*\*Status\*\*:\s*(.+)$/, /^\*\*Status:\*\*\s*(.+)$/];

export function matchStatusLine(line) {
  for (const re of STATUS_FORMS) {
    const m = re.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}

/** Parse `git log -p` output (records delimited by \x1e, header fields by
 *  \x1f) into the `Draft → Accepted` status flips it introduced.
 *
 *  A flip requires **both sides of the transition** in the same file's hunk:
 *  a removed status line that is not already Accepted, and an added one that
 *  is. Counting a bare added-Accepted line instead would count file
 *  *additions* as flips — and on real history that is not hypothetical: the
 *  2026-07-26 tree reorganisation relocated four already-Accepted epics, and
 *  an added-line-only parser reports them as four status flips in a month
 *  that had none. The taxonomy names the transition, not the state. */
export function parseEpicStatusFlipsFromLog(logText) {
  const flips = [];
  for (const record of logText.split("\x1e")) {
    if (!record.trim()) continue;
    const nl = record.indexOf("\n");
    const header = (nl === -1 ? record : record.slice(0, nl)).trim();
    const [sha, date] = header.split("\x1f");
    if (!sha || !date) continue;
    let file = null;
    /** file → { removed: string|null, added: string|null } */
    const perFile = new Map();
    for (const line of record.slice(nl + 1).split("\n")) {
      if (line.startsWith("+++ b/")) {
        file = line.slice(6).trim();
        if (!perFile.has(file)) perFile.set(file, { removed: null, added: null });
        continue;
      }
      if (line.startsWith("--- ") || line.startsWith("+++")) continue;
      if (!file) continue;
      const side = line[0];
      if (side !== "+" && side !== "-") continue;
      const status = matchStatusLine(line.slice(1));
      if (status === null) continue;
      const entry = perFile.get(file);
      if (side === "+") entry.added ??= status;
      else entry.removed ??= status;
    }
    for (const [f, { removed, added }] of perFile) {
      if (added === null || !/^Accepted/i.test(added)) continue;
      if (removed === null || /^Accepted/i.test(removed)) continue;
      flips.push({ sha, date, file: f, status: added, from: removed });
    }
  }
  return flips;
}

/** Directly-referenced stories of an epic — not their descendants (the
 *  taxonomy's closed enumeration for T6). Read as the distinct issue numbers
 *  the epic file itself links. */
export function countReferencedStories(epicMd) {
  const nums = new Set();
  for (const m of epicMd.matchAll(/\/issues\/(\d+)/g)) nums.add(m[1]);
  for (const m of epicMd.matchAll(/(?:^|\s)#(\d{1,6})\b/g)) nums.add(m[1]);
  return nums.size;
}

function collectT6(w) {
  const dir = join(ROOT, "workforce", "docs", "epics");
  if (!existsSync(dir)) return result("T6", { touches: null, unavailableReason: `${dir} not found` });
  let log;
  try {
    log = execFileSync(
      "git",
      ["log", "--format=%x1e%H%x1f%aI", "-p", "--unified=0", "--", "workforce/docs/epics"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
  } catch (err) {
    return result("T6", { touches: null, unavailableReason: `git log failed: ${err.message}` });
  }
  const flips = parseEpicStatusFlipsFromLog(log).filter((f) => inWindow(f.date, w));
  let workUnits = 0;
  for (const f of flips) {
    const path = join(ROOT, f.file);
    if (existsSync(path)) workUnits += countReferencedStories(readFileSync(path, "utf8"));
  }
  return result("T6", { touches: flips.length, workUnits });
}

// ── T7 — hire rounds ──────────────────────────────────────────────────────

/** Personas a round registered. The round docs list them in a roster table or
 *  as `slug` headings; we count distinct backticked slugs in the doc's roster
 *  section, falling back to 1-and-flag when none parse (Epic-020 Q1:
 *  under-claiming beats storytelling). */
export function countRoundPersonas(md) {
  const slugs = new Set();
  for (const m of md.matchAll(/^\s*\|\s*`?([a-z][a-z0-9-]{2,20})`?\s*\|/gm)) slugs.add(m[1]);
  return slugs.size;
}

/** Group round docs by the commit that added them. The touch is the
 *  **sign-off**, not the file: one merging PR is one operator terminal
 *  action however many docs it carries. This matters on real history — the
 *  2026-07-26 commit added eight pre-existing round docs at once when the
 *  tree was reorganised, and counting files would have reported eight hire
 *  rounds in a month that had none. A commit adding more than one round doc
 *  is a bulk move rather than a multi-round sign-off, so it is credited `1`
 *  and flagged (Epic-020 Q1: under-claiming beats storytelling). */
export function groupRoundsByCommit(entries) {
  const bySha = new Map();
  for (const e of entries) {
    if (!bySha.has(e.sha)) bySha.set(e.sha, { sha: e.sha, date: e.date, files: [] });
    bySha.get(e.sha).files.push(e.file);
  }
  return [...bySha.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function collectT7(w) {
  const dir = join(ROOT, "workforce", "docs", "hires");
  if (!existsSync(dir)) return result("T7", { touches: null, unavailableReason: `${dir} not found` });
  const entries = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const rel = `workforce/docs/hires/${name}`;
    let line;
    try {
      line = execFileSync("git", ["log", "--diff-filter=A", "--format=%H%x1f%aI", "--", rel], {
        cwd: ROOT,
        encoding: "utf8",
      }).trim().split("\n").filter(Boolean).pop();
    } catch {
      continue;
    }
    if (!line) continue;
    const [sha, date] = line.split("\x1f");
    if (!inWindow(date, w)) continue;
    entries.push({ sha, date, file: rel });
  }

  const rounds = groupRoundsByCommit(entries);
  let workUnits = 0;
  let ambiguous = 0;
  for (const round of rounds) {
    if (round.files.length > 1) {
      // Bulk move: one touch, credited 1 work unit and flagged.
      ambiguous += 1;
      workUnits += 1;
      console.error(`WARN: ${round.sha.slice(0, 8)} added ${round.files.length} round docs at once — bulk move, credited 1 and flagged`);
      continue;
    }
    const n = countRoundPersonas(readFileSync(join(ROOT, round.files[0]), "utf8"));
    if (n === 0) ambiguous += 1;
    workUnits += n === 0 ? 1 : n;
  }
  return result("T7", { touches: rounds.length, workUnits, ambiguous });
}

// ── T1 / T2 — GitHub PR metadata ──────────────────────────────────────────

const NEEDS_HUMAN = "autopilot:needs-human";
const REASON_PREFIX = "autopilot:reason:";

/** Split a window's terminated PRs into the two operator-touch types.
 *
 *  Trap 2: `merged_by` is not admissible — an R-N10 delegated merge executes
 *  through the project PAT and renders as the operator. The human touch is
 *  therefore *terminal action on a labelled PR*: `autopilot:needs-human`
 *  (escalated to the operator) is T2, and a PR carrying a reason label
 *  without needs-human is a delegated merge and is NOT a human touch. A PR
 *  with no reason label at all buckets as `unspecified` — reported, never
 *  silently counted as human. */
export function classifyPrTouches(prs) {
  const t1 = [];
  const t2 = [];
  let unspecified = 0;
  for (const pr of prs) {
    const labels = pr.labels ?? [];
    const escalated = labels.includes(NEEDS_HUMAN);
    const hasReason = labels.some((l) => l.startsWith(REASON_PREFIX));
    if (escalated) {
      t2.push(pr);
      t1.push(pr);
    } else if (!hasReason) {
      unspecified += 1;
    }
  }
  return { t1, t2, unspecified };
}

async function collectGithubTouches(w, repo, token) {
  if (!token) {
    const why = "GITHUB_TOKEN not set — PR metadata unreadable";
    return [result("T1", { touches: null, unavailableReason: why }), result("T2", { touches: null, unavailableReason: why })];
  }
  const [owner, name] = repo.split("/");
  const prs = [];
  try {
    for (let page = 1; page <= 20; page += 1) {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${name}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "wf-human-touch",
          },
        },
      );
      if (!res.ok) throw new Error(`GitHub ${res.status} ${res.statusText}`);
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const pr of batch) {
        const closed = pr.merged_at ?? pr.closed_at;
        if (!closed) continue;
        prs.push({
          number: pr.number,
          closed_at: closed,
          merged: Boolean(pr.merged_at),
          changed_files: pr.changed_files ?? 0,
          labels: (pr.labels ?? []).map((l) => l.name),
        });
      }
      // Sorted by updated desc; stop once a whole page predates the window.
      if (batch.every((pr) => (pr.updated_at ?? "") < w.start)) break;
    }
  } catch (err) {
    const why = `GitHub read failed: ${err.message}`;
    return [result("T1", { touches: null, unavailableReason: why }), result("T2", { touches: null, unavailableReason: why })];
  }

  const scoped = prs.filter((pr) => inWindow(pr.closed_at, w));
  const { t1, t2, unspecified } = classifyPrTouches(scoped);
  if (unspecified > 0) {
    console.error(`WARN: ${unspecified} terminated PR(s) in ${w.start.slice(0, 7)} carry no ${REASON_PREFIX}* label — bucketed unspecified, not counted as human`);
  }
  // T1 credits the merged diff's changed files. The list endpoint does NOT
  // return `changed_files` — only the single-PR GET does — so without this
  // second read every T1 row would fall through to the credit-1-and-flag
  // path and the gate table's leverage would be a count of PRs wearing a
  // count of files' clothes. A PR whose detail read fails is credited 1 and
  // flagged rather than dropped.
  let t1Units = 0;
  let t1Ambiguous = 0;
  for (const pr of t1) {
    let files = pr.changed_files;
    if (!files) {
      try {
        const res = await fetch(`https://api.github.com/repos/${owner}/${name}/pulls/${pr.number}`, {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "wf-human-touch",
          },
        });
        if (res.ok) files = (await res.json()).changed_files ?? 0;
      } catch {
        files = 0;
      }
    }
    if (files > 0) t1Units += files;
    else { t1Units += 1; t1Ambiguous += 1; }
  }
  return [
    result("T1", { touches: t1.length, workUnits: t1Units, ambiguous: t1Ambiguous }),
    result("T2", { touches: t2.length, workUnits: t2.length }),
  ];
}

// ── T4 — AUDIT# rows ──────────────────────────────────────────────────────

async function importLambdaDep(spec) {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const lambdasReq = createRequire(join(ROOT, "workforce", "lambdas", "package.json"));
  return import(pathToFileURL(lambdasReq.resolve(spec)).href);
}

async function collectT4(w, table, region) {
  try {
    const { DynamoDBClient } = await importLambdaDep("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, ScanCommand } = await importLambdaDep("@aws-sdk/lib-dynamodb");
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    let mutations = 0;
    let last;
    do {
      const out = await ddb.send(
        new ScanCommand({
          TableName: table,
          FilterExpression: "begins_with(pk, :p) AND #ts BETWEEN :s AND :e",
          ExpressionAttributeNames: { "#ts": "created_at" },
          ExpressionAttributeValues: { ":p": "AUDIT#", ":s": w.start, ":e": w.end },
          ExclusiveStartKey: last,
        }),
      );
      mutations += out.Items?.length ?? 0;
      last = out.LastEvaluatedKey;
    } while (last);
    // One digest review per ISO week touched by the window's mutations; the
    // digest is weekly, so the touch count is weeks-reviewed, not mutations.
    const weeks = Math.max(1, Math.ceil((Date.parse(w.end) - Date.parse(w.start)) / (7 * 864e5)));
    return result("T4", { touches: mutations > 0 ? weeks : 0, workUnits: mutations });
  } catch (err) {
    return result("T4", { touches: null, unavailableReason: `AUDIT# scan failed: ${err.message}` });
  }
}

// ── main ──────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

async function main() {
  const month = arg("month");
  if (typeof month !== "string") {
    console.error("build-human-touch.mjs: --month YYYY-MM is required");
    return 1;
  }
  const w = monthWindow(month);
  const repo = arg("repo", "refluster/ai-native-article");
  const table = arg("table", process.env.TABLE_NAME ?? "wf-table-prod");
  const region = arg("region", "us-west-2");
  const publish = process.argv.includes("--publish-ddb");

  const governance = join(ROOT, "workforce", "docs", "governance.md");
  const results = [
    ...(await collectGithubTouches(w, repo, process.env.GITHUB_TOKEN)),
    result("T3", { touches: null, unavailableReason: "estimated: Notion gate-flip event row not yet written (taxonomy Trap 1)" }),
    publish
      ? await collectT4(w, table, region)
      : result("T4", { touches: null, unavailableReason: "AUDIT# scan requires --publish-ddb (DDB access)" }),
    existsSync(governance)
      ? collectT5(readFileSync(governance, "utf8"), w)
      : result("T5", { touches: null, unavailableReason: `${governance} not found` }),
    collectT6(w),
    collectT7(w),
  ];

  const block = aggregateHumanTouches(results, {
    month,
    window: { start: w.start, end: w.end },
    taxonomyVersion: TAXONOMY_VERSION,
    updatedAt: new Date().toISOString(),
  });

  console.log(JSON.stringify(block, null, 2));

  for (const c of block.classes) {
    if (c.unavailable.length) {
      console.error(`WARN: ${c.class}-class is a floor, not a count — unreadable: ${c.unavailable.join(", ")}`);
    }
  }

  if (publish) {
    const { DynamoDBClient } = await importLambdaDep("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, PutCommand } = await importLambdaDep("@aws-sdk/lib-dynamodb");
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: { pk: "PERF#workforce", sk: "HUMAN-TOUCH", scope: "workforce", ...block },
      }),
    );
    console.error(`published PERF#workforce/HUMAN-TOUCH (${month}) to ${table}`);
  }

  // Epic-020's falsifier is a run outcome, not a footnote: a month that
  // cannot count ≥80% of the countable-designated types exits non-zero so CI
  // and the operator both see it.
  if (!block.coverage.meets_bar) {
    console.error(
      `FAIL: countable coverage ${block.coverage.mechanically_counted}/${block.coverage.countable_designated}` +
        ` (${block.coverage.share}) is below the 0.8 bar — missing: ${block.coverage.missing.join(", ")}`,
    );
    return 2;
  }
  return 0;
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
