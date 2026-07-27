#!/usr/bin/env node
// ops-accountability-watch/payload.mjs — pure payload construction: turns a
// list of normalized Findings into (a) one GitHub Issue spec per finding and
// (b) exactly ONE aggregate notification payload for the whole fire.
//
// Deliberately two attention classes (workforce/docs/runbooks/
// chat-notification-policy.md), never per-finding chat pings:
//   - "Awareness Only"    — nothing needs a human; the mirror stays quiet-but-
//                           present so silence never means "did this even run?"
//   - "Repair Required"   — >=1 finding opened/updated; the chat message links
//                           every Issue instead of restating its content.
//
// Dependency-free and pure: no network, no Date.now()/Math.random() (the
// caller supplies `now` so behaviour is reproducible in tests).

export const ISSUE_TITLE_PREFIX = "[ops-accountability-watch]";

/**
 * @typedef {object} Finding
 * @property {"ci-run"|"backlog-stale"} kind
 * @property {string} key            stable dedupe key, e.g. "ci-run:deploy-article-site.yml"
 * @property {string} label          short human label, e.g. "deploy-article-site.yml — failure"
 * @property {string[]} detailLines  markdown bullet lines for the issue body
 * @property {string} sourceUrl
 * @property {string} owner          routed owner slug
 * @property {string} ownerReason
 * @property {"workforce"|"article"} project
 * @property {string} closeCondition human-readable close condition
 */

/**
 * @typedef {object} IssueSpec
 * @property {string} title
 * @property {string} body
 * @property {string[]} labels
 * @property {string} owner
 * @property {string} key
 */

/**
 * @param {Finding} finding
 * @returns {IssueSpec}
 */
export function buildIssueSpec(finding) {
  for (const field of ["kind", "key", "label", "owner", "ownerReason", "project", "closeCondition"]) {
    if (!finding || !finding[field]) {
      throw new Error(`buildIssueSpec: finding.${field} is required`);
    }
  }
  const title = `${ISSUE_TITLE_PREFIX} ${finding.label}`;
  const body = [
    `**Detected by**: ops-accountability-watch (Cadence, Petra — VP, Operations & Reliability)`,
    `**Owner**: \`${finding.owner}\` — ${finding.ownerReason}`,
    "",
    "### What was observed",
    ...(finding.detailLines ?? []).map((l) => `- ${l}`),
    "",
    finding.sourceUrl ? `**Source**: ${finding.sourceUrl}` : null,
    "",
    `### Close condition`,
    finding.closeCondition,
    "",
    "_This is a persistent, owner-routed ledger entry — the accompanying chat notification links here rather than restating the detail. Re-fires of this Cadence update this issue in place rather than opening a duplicate (matched on title)._",
  ]
    .filter((l) => l !== null)
    .join("\n");

  return {
    title,
    body,
    labels: ["type:ops", "layer:L3", `project:${finding.project}`, `owner:${finding.owner}`],
    owner: finding.owner,
    key: finding.key,
  };
}

/**
 * @typedef {object} IssueLink
 * @property {string} key    the Finding.key it corresponds to
 * @property {string} url
 * @property {"created"|"updated"} action
 * @property {string} owner
 * @property {string} title
 */

/**
 * @typedef {object} NotificationPayload
 * @property {"awareness-only"|"repair-required"} mode
 * @property {string} username
 * @property {number} color
 * @property {string} title
 * @property {string} description
 */

const AWARENESS_COLOR = 0x2e7d32; // green
const REPAIR_COLOR = 0xc62828; // red

/**
 * @param {IssueLink[]} issueLinks   empty when nothing needed a follow-up
 * @param {{ sweptSurfaces: string[], mode: "observation"|"steady" }} context
 * @param {Date} now
 * @returns {NotificationPayload}
 */
export function buildNotificationPayload(issueLinks, context, now) {
  const dateStr = now.toISOString().slice(0, 10);
  const sweptList = (context?.sweptSurfaces ?? []).join(", ") || "(none configured)";

  if (!issueLinks || issueLinks.length === 0) {
    const modeNote =
      context?.mode === "observation"
        ? "Observation mode: this quiet mirror is intentional — see workforce/docs/runbooks/chat-notification-policy.md for the exit condition."
        : "Steady state: quiet fires stay silent going forward per the observation-mode exit condition; this mirror is the periodic proof that the sweep itself is still alive.";
    return {
      mode: "awareness-only",
      username: "ops-accountability-watch",
      color: AWARENESS_COLOR,
      title: `Awareness Only — ${dateStr} — 0 follow-ups`,
      description: [`Swept: ${sweptList}.`, "Nothing needs a human right now.", modeNote].join(" "),
    };
  }

  const lines = issueLinks.map(
    (l) => `• \`${l.owner}\` — ${l.title} — ${l.action === "created" ? "opened" : "updated"}: ${l.url}`,
  );
  return {
    mode: "repair-required",
    username: "ops-accountability-watch",
    color: REPAIR_COLOR,
    title: `Repair Required — ${dateStr} — ${issueLinks.length} follow-up${issueLinks.length === 1 ? "" : "s"}`,
    description: [`Swept: ${sweptList}.`, "", ...lines].join("\n"),
  };
}

/**
 * Discord webhook execute-endpoint body (documented shape: content/username/
 * embeds[]) built from a NotificationPayload.
 * @param {NotificationPayload} payload
 * @returns {object}
 */
export function toDiscordWebhookBody(payload) {
  return {
    username: payload.username,
    embeds: [{ title: payload.title, description: payload.description, color: payload.color }],
  };
}
