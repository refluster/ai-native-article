#!/usr/bin/env node
// backfill-performance-lifecycle.mjs — Epic-016 Phase 3.
//
// The daily wf-performance-reducer snapshots TODAY and appends one point; it
// cannot reconstruct the past, so a freshly-deployed reducer leaves the
// lifecycle chart flat (one point) until ~28 days accrue. This one-shot
// backfill RECONSTRUCTS the trailing window from history already in DDB —
// per agent: `created_at` (when it entered the cohort) + the earliest
// `status:ok` EXEC (when it first delivered) + its current triggerable
// bindings — and writes the 28-point `PERF#{scope}/LIFECYCLE` roll-up the
// `/performance` endpoint reads, workforce-wide and per active project.
//
// Delivered uses the Phase-3 definition (any status:ok execution, artefact or
// engagement), matching the reducer. `assigned` is approximated by the agent's
// CURRENT triggerable bindings (binding-add history isn't cheaply replayable);
// the delivered curve — the meaningful read — is exact from EXEC history.
//
// Standalone (raw AWS SDK + the session's AWS creds, like the engagement
// logger); the daily reducer remains the ongoing writer. Re-runnable/idempotent
// (overwrites the LIFECYCLE item). Preview with --dry-run.
//
// Usage:
//   node workforce/scripts/backfill-performance-lifecycle.mjs \
//     [--table wf-table-prod] [--days 28] [--dry-run]
// (run from workforce/lambdas/ so @aws-sdk resolves, or with NODE_PATH set.)

// ── pure logic (unit-tested) ─────────────────────────────────────────────────

/** A binding fires automatically (not manual/dead) — mirrors
 *  shared/agent.ts bindingCronIsLoadBearing. */
export function isTriggerable(binding) {
  const t = binding?.trigger ?? {};
  const s = t.scheduler;
  const orchestratorCcr =
    binding?.executor === "claude-code-routine" && s === "external" && t.invoked_by === "api";
  return orchestratorCcr || s === "eventbridge" || s === "gha" || s === "claude-code-routine";
}

/** Furthest reached state of one agent AS OF the end of a day (cumulative).
 *  Returns null when the agent had not been created yet (not in the cohort). */
export function classifyAsOf(agent, dayEndIso) {
  if (!agent.createdAt || agent.createdAt > dayEndIso) return null;
  if (agent.firstOkExecAt && agent.firstOkExecAt <= dayEndIso) return "delivered";
  if (agent.hasTriggerableBinding) return "assigned";
  return "registered";
}

/** Build the trailing daily lifecycle series from per-agent facts. */
export function buildLifecycleHistory(agents, days) {
  return days.map((date) => {
    const end = `${date}T23:59:59.999Z`;
    const point = { date, registered: 0, assigned: 0, delivered: 0 };
    for (const a of agents) {
      const state = classifyAsOf(a, end);
      if (state) point[state] += 1;
    }
    return point;
  });
}

/** Last n UTC days as YYYY-MM-DD, oldest→newest. */
export function lastNDaysUTC(n, today = new Date()) {
  const base = new Date(today);
  base.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

// ── CLI / IO ─────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

async function main() {
  const TABLE = arg("table", process.env.TABLE_NAME || "wf-table-prod");
  const DAYS = Number(arg("days", 28));
  const DRY = process.argv.includes("--dry-run");

  // @aws-sdk lives in workforce/lambdas/node_modules; resolve it from there so
  // this script runs from any cwd (ESM bare-specifier resolution is
  // file-relative and wouldn't find it from workforce/scripts otherwise).
  const { createRequire } = await import("node:module");
  const { pathToFileURL, fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const lambdasReq = createRequire(
    join(dirname(fileURLToPath(import.meta.url)), "..", "lambdas", "package.json"),
  );
  const importLambdaDep = (spec) => import(pathToFileURL(lambdasReq.resolve(spec)).href);
  const { DynamoDBClient } = await importLambdaDep("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, ScanCommand, QueryCommand, PutCommand } =
    await importLambdaDep("@aws-sdk/lib-dynamodb");
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });

  const scanAll = async (params) => {
    const items = [];
    let ExclusiveStartKey;
    do {
      const r = await ddb.send(new ScanCommand({ ...params, ExclusiveStartKey }));
      items.push(...(r.Items ?? []));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  };
  const queryAll = async (params) => {
    const items = [];
    let ExclusiveStartKey;
    do {
      const r = await ddb.send(new QueryCommand({ ...params, ExclusiveStartKey }));
      items.push(...(r.Items ?? []));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  };

  // 1. cohort: every AGENT#{slug}/META.
  const metas = await scanAll({
    TableName: TABLE,
    FilterExpression: "begins_with(#pk, :a) AND #sk = :m",
    ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
    ExpressionAttributeValues: { ":a": "AGENT#", ":m": "META" },
  });

  // 2. per agent: earliest ok-exec (global + per project) via GSI1, oldest-first.
  const agentFacts = new Map(); // slug -> { createdAt, bindings, firstOkExecAt, firstOkByProject }
  for (const m of metas) {
    const execs = await queryAll({
      TableName: TABLE,
      IndexName: "GSI1",
      KeyConditionExpression: "#g = :g",
      ExpressionAttributeNames: { "#g": "gsi1pk" },
      ExpressionAttributeValues: { ":g": `AGENT#${m.slug}` },
      ScanIndexForward: true, // oldest first
    });
    let firstOkExecAt;
    const firstOkByProject = new Map();
    for (const e of execs) {
      if (e.status !== "ok") continue;
      const at = e.started_at;
      if (!at) continue;
      if (!firstOkExecAt || at < firstOkExecAt) firstOkExecAt = at;
      const pid = e.project_id;
      if (pid && (!firstOkByProject.has(pid) || at < firstOkByProject.get(pid))) {
        firstOkByProject.set(pid, at);
      }
    }
    agentFacts.set(m.slug, {
      createdAt: m.created_at,
      bindings: Array.isArray(m.bindings) ? m.bindings : [],
      firstOkExecAt,
      firstOkByProject,
    });
  }

  const days = lastNDaysUTC(DAYS);
  const writes = [];

  // 3. workforce scope.
  const wfAgents = [...agentFacts.entries()].map(([slug, f]) => ({
    slug,
    createdAt: f.createdAt,
    firstOkExecAt: f.firstOkExecAt,
    hasTriggerableBinding: f.bindings.some(isTriggerable),
  }));
  writes.push({ scope: "workforce", points: buildLifecycleHistory(wfAgents, days) });

  // 4. per active project scope.
  const projects = (
    await scanAll({
      TableName: TABLE,
      FilterExpression: "begins_with(#pk, :p) AND #sk = :m",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":p": "PROJECT#", ":m": "META" },
    })
  ).filter((p) => p.status === "active");

  for (const proj of projects) {
    const pid = proj.project_id;
    const memberRows = await queryAll({
      TableName: TABLE,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :m)",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": `PROJECT#${pid}`, ":m": "MEMBER#" },
    });
    const members = memberRows.filter((r) => r.revoked_at === undefined).map((r) => r.agent_slug);
    if (members.length === 0) continue;
    const projAgents = members.map((slug) => {
      const f = agentFacts.get(slug) ?? { createdAt: undefined, bindings: [], firstOkByProject: new Map() };
      return {
        slug,
        createdAt: f.createdAt,
        firstOkExecAt: f.firstOkByProject?.get(pid),
        hasTriggerableBinding: f.bindings.some(
          (b) => isTriggerable(b) && b.project_id === pid,
        ),
      };
    });
    writes.push({ scope: pid, points: buildLifecycleHistory(projAgents, days) });
  }

  // 5. emit / write.
  for (const w of writes) {
    const last = w.points[w.points.length - 1];
    console.error(
      `${DRY ? "[dry-run] " : ""}PERF#${w.scope}/LIFECYCLE — ${w.points.length}d, latest ` +
        `r${last.registered}/a${last.assigned}/d${last.delivered}`,
    );
    if (!DRY) {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            pk: `PERF#${w.scope}`,
            sk: "LIFECYCLE",
            scope: w.scope,
            updated_at: new Date().toISOString(),
            points: w.points,
          },
        }),
      );
    }
  }
  console.error(`${DRY ? "[dry-run] " : ""}done — ${writes.length} scope(s).`);
  return 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
