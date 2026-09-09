#!/usr/bin/env node
// report-performance-refresh.mjs — turns a performance-refresh report into a
// GitHub Actions verdict (workforce-performance-refresh.yml, step "Report
// verdict"). No network, no AWS: it reads the JSON refresh.mjs already wrote.
//
// WHY THIS ISN'T `exit $?`
// ------------------------
// refresh.mjs collapses two different outcomes into exit 2: "a leg FAILED"
// and "a leg published but came back DEGRADED" (a rate-limited PR page, a
// code_frequency timeout — an undercount, never a real low). That is the
// right shape for the Cadence, whose whole job is to narrate the difference
// in a feed note. A scheduled workflow has no narrator, so the distinction
// has to land in the run's own status instead:
//
//   failed leg / nothing refreshed / no report  -> exit 1, the run is RED
//   degraded leg, or a block still stale after  -> ::warning + summary, GREEN
//   the write                                      (it published; a red run
//                                                   every time GitHub rate-
//                                                   limits one page trains
//                                                   the operator to ignore
//                                                   this workflow)
//
// Either way the per-scope verdict is written to the job summary, so a
// frozen block is visible from the run page without opening an artifact.
//
// Usage: node workforce/scripts/report-performance-refresh.mjs <report.json> <refresh-exit-code>

import { appendFileSync, existsSync, readFileSync } from "node:fs";

const [reportPath, exitCodeArg] = process.argv.slice(2);
const refreshExit = Number(exitCodeArg);

function emit(line) {
  console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${line}\n`);
}

if (!reportPath || !existsSync(reportPath)) {
  console.log(
    `::error::performance refresh wrote no report at ${reportPath ?? "(no path given)"} ` +
      `(refresh.mjs exited ${Number.isFinite(refreshExit) ? refreshExit : "?"}). ` +
      `Nothing was verified — treat the PR/REPO roll-ups as NOT refreshed.`,
  );
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (err) {
  console.log(`::error::performance refresh report at ${reportPath} is not valid JSON: ${err.message}`);
  process.exit(1);
}

const verdict = report.verdict ?? {};
const failed = verdict.failed ?? [];
const degraded = verdict.degraded ?? [];
const staleRepo = verdict.stale_repo_scopes ?? [];
const missingRepo = verdict.missing_repo_scopes ?? [];

emit(`## Performance refresh — ${report.generated_at ?? "(no timestamp)"}`);
emit("");
emit(`- window rebuilt: **${report.days ?? "?"} days** · table \`${report.table ?? "?"}\``);
emit(`- scopes: ${(report.scopes ?? []).map((s) => `\`${s}\``).join(", ") || "_none_"}`);
emit(`- legs: ${(report.legs ?? []).length} · failed ${failed.length} · degraded ${degraded.length}`);
emit("");

// Per-scope read-back — the answer to "is the console serving today's numbers
// now?", which is the only question this workflow exists to settle.
if ((report.observed ?? []).length > 0) {
  emit("| scope | lifecycle → | PR → | PR total | repo block |");
  emit("| --- | --- | --- | --- | --- |");
  for (const o of report.observed) {
    if (!o.reachable) {
      emit(`| \`${o.scope}\` | _unreachable_ | | | ${o.status ?? o.error ?? ""} |`);
      continue;
    }
    const repo = o.repo ? `${o.repo.freshness?.state ?? "?"} (${o.repo.updated_at ?? "?"})` : "**missing**";
    emit(
      `| \`${o.scope}\` | ${o.lifecycle?.last_date ?? "—"} | ${o.pr?.last_date ?? "—"} | ` +
        `${o.pr?.total_prs ?? 0} | ${repo} |`,
    );
  }
  emit("");
}

if (report.fatal) {
  console.log(`::error::performance refresh aborted: ${report.fatal} — ${report.detail ?? ""}`);
  process.exit(1);
}

for (const label of failed) {
  const leg = (report.legs ?? []).find((l) => l.label === label);
  console.log(`::error::refresh leg "${label}" FAILED: ${leg?.error ?? "(no detail)"}`);
}
for (const label of degraded) {
  const leg = (report.legs ?? []).find((l) => l.label === label);
  console.log(
    `::warning::refresh leg "${label}" published but is DEGRADED (an undercount, never a real low): ` +
      `${leg?.tail ?? "(no detail)"}`,
  );
}
// A block that is still stale AFTER a successful write means the write did not
// reach the endpoint the console reads — a different fault from a failed leg,
// and one that would otherwise look like success.
for (const scope of staleRepo) {
  console.log(
    `::warning::scope "${scope}" still serves a STALE repo block after this refresh — ` +
      `the write did not reach the endpoint the console reads.`,
  );
}
for (const scope of missingRepo) {
  console.log(`::warning::scope "${scope}" serves NO repo block; the Repository Performance deck falls back to the bundled snapshot.`);
}

if (failed.length > 0 || refreshExit === 3) {
  console.log(
    "::error::the PR/repository roll-ups behind /performance were not fully refreshed; " +
      "the console is serving data older than today for at least one scope.",
  );
  process.exit(1);
}
process.exit(0);
