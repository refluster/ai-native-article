// request-dispatch.mjs — ask the workforce to fire another cadence's binding
// NOW, from inside a running CCR session (adr-0025).
//
// The lane hand-off this exists for: `pr-autopilot` finds an agent-fixable
// defect, parks the PR in the author lane (`autopilot:needs-author`) and — with
// this — asks for `pr-remediate` to be fired against the same project in the
// same breath, instead of leaving the PR to wait for that cadence's next cron.
// `pr-remediate` does the reverse when it pushes a fix: it asks for
// `pr-autopilot`, so the re-review happens now rather than at the next tick.
//
// Three properties are deliberate:
//
//   1. **Best-effort, never load-bearing.** Every failure path — no token
//      injected, endpoint down, 4xx, 5xx, network — logs one line and returns
//      `{ dispatched: false, why }`. The caller ignores the result. The
//      hand-off itself (the comment + the label move) is the load-bearing
//      write; the dispatch only decides whether the worker starts in seconds
//      or at its next cron. This is NOT a C-4 exception: the binding's cron is
//      the completeness floor and `pr-autopilot-sweep.mjs`'s 36h `author-stale`
//      escalation is still the backstop, so a dropped dispatch degrades
//      latency, never correctness.
//
//   2. **It cannot schedule anything new.** The endpoint fires an existing
//      (skill, project) binding on the named agent or refuses (R-N4). A 404
//      here means the operator has not wired that cadence for that project —
//      which is exactly the diagnosis worth having in the log.
//
//   3. **It is rate-limited server-side.** A 409 `debounced` is a normal
//      answer: a live run already owns that queue and will drain the work.
//      Logged at info, not as a warning.
//
// The capability token arrives in the task's credential bag as
// `credentials['workforce.dispatch_token'].token` (the skill declares
// `workforce.dispatch_token` in meta.json:requires[]); the runner exports it as
// WF_DISPATCH_TOKEN for the write-script, exactly as it does the other
// per-fire tokens.

// R-14: the module reaches the network, so it carries the proxy bootstrap even
// though it is always imported (the call is a no-op unless this file is the
// process entry point).
import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

/** Default agents-api base — the execute-api origin, which is reachable from
 *  restricted network allowlists that block the ADR-0004 custom domain. Same
 *  constant-in-the-script convention every other skill write-script uses. */
export const DEFAULT_API_BASE = "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod";

/**
 * POST /dispatch. Returns `{ dispatched, status?, why? }` and never throws.
 *
 * @param {{agent_slug: string, skill: string, project_id: string, reason?: string,
 *          token?: string, apiBase?: string, timeoutMs?: number, log?: (s: string) => void}} opts
 */
export async function requestDispatch(opts) {
  const {
    agent_slug,
    skill,
    project_id,
    reason,
    token = process.env.WF_DISPATCH_TOKEN,
    apiBase = process.env.WF_AGENTS_API_BASE || DEFAULT_API_BASE,
    timeoutMs = 10_000,
    log = (s) => console.error(s),
  } = opts ?? {};

  // agent_slug is optional by design: the caller names the CADENCE it wants
  // woken, and the endpoint resolves which persona is bound to it from
  // bindings[]. Pass it only to disambiguate a cadence two agents share.
  if (!skill || !project_id) {
    return done(log, { dispatched: false, why: "skill and project_id are required" });
  }
  if (!token) {
    // Not an error: a fire whose skill has not (yet) declared
    // `workforce.dispatch_token` simply has no token, and the cron path is
    // what runs. Say so once so the operator can tell "not wired" from "wired
    // and failing".
    return done(log, { dispatched: false, why: `no WF_DISPATCH_TOKEN in env — ${skill}@${project_id} will start on its own cron` });
  }

  const url = `${String(apiBase).replace(/\/+$/, "")}/dispatch`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ agent_slug, skill, project_id, reason }),
      signal: ctl.signal,
    });
  } catch (e) {
    return done(log, { dispatched: false, why: `network error: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    clearTimeout(timer);
  }

  const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => "");
  if (res.status === 202) {
    return done(log, { dispatched: true, status: 202, why: `${skill}@${project_id} fired now` });
  }
  if (res.status === 409) {
    return done(log, { dispatched: false, status: 409, why: `${skill}@${project_id} already running / debounced — that run drains this queue` });
  }
  return done(log, { dispatched: false, status: res.status, why: `HTTP ${res.status}: ${detail}` });
}

function done(log, out) {
  log(`request-dispatch: ${out.dispatched ? "ok" : "no-op"} — ${out.why}`);
  return out;
}
