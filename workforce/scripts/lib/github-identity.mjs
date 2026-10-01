// github-identity.mjs — the GitHub account a workforce write lands as, and the
// one mechanical check that decides whether a CCR fire may write (ML-040,
// issues #777 / #781).
//
// THE FACT. Inside a CCR session every call to api.github.com (raw HTTPS from a
// write-script, `gh`, `git push`, the GitHub MCP connector) is authenticated by
// the CCR platform as the routine's owner, whatever `Authorization` header the
// caller sends. Fires reproduced this repeatedly from 2026-09-18 to 09-28 (real
// token, bogus token, no token → the same `login`; PR #776, issue #777). The
// injected `credentials['github.token']` is therefore not what GitHub sees
// from a fire. It still is on the Lambda-side paths and in a local operator run.
//
// THE GAP (#781). No write path checked which account it was about to write
// as. The only guard was a persona diagnosing it by hand in-session, which
// "does not scale past that one persona's memory" (#777) and did not hold even
// within one binding's fires on one day.
//
// THE CHECK. `assertGithubIdentity()` asks `GET /user` once, before the first
// write, and passes only when the login is in the expected set. Any other
// login throws, and so does an unreadable one: an identity nobody can name is
// not one to write under (W-4). This is a tightening. It adds a refusal path to
// every CCR write and relaxes nothing.
//
// The default set is the account CCR fires write as today (the routine owner).
// WHETHER the workforce should keep writing as that account, or move to a bot
// identity, is the operator's decision (#777). It is not this file's.
// `WF_GITHUB_EXPECTED_LOGINS` (comma-separated) overrides the set, for a local
// operator run under a different account or a future bot identity.

/** The account CCR fires currently write as: the routine owner (#777). */
export const DEFAULT_EXPECTED_GITHUB_LOGINS = Object.freeze(["refluster"]);

export class GithubIdentityError extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = "GithubIdentityError";
    // `msg` + `code` mirror the plain `{code, msg}` objects makeGh() already
    // throws, so every existing `catch (e) { e?.msg || e?.message }` and
    // `return e?.code || 3` renders this without change.
    this.msg = msg;
    this.code = code;
  }
}

/** The expected login set: the env override if present, else the default. */
export function expectedLogins(env = process.env) {
  const raw = String(env?.WF_GITHUB_EXPECTED_LOGINS ?? "").trim();
  if (!raw) return [...DEFAULT_EXPECTED_GITHUB_LOGINS];
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Whether a write-script in this process must run the preflight: always inside
 *  a CCR session (where ML-040 lives), and wherever the operator has opted in by
 *  naming an expected set. NOT in GitHub Actions or Lambda: an Actions
 *  installation token cannot read `GET /user` (403), and those paths never
 *  go through the CCR proxy. */
export function identityCheckRequired(env = process.env) {
  return Boolean(env?.CLAUDE_CODE_REMOTE) || Boolean(String(env?.WF_GITHUB_EXPECTED_LOGINS ?? "").trim());
}

/** Pure verdict over one `GET /user` response. */
export function identityVerdict({ status, login } = {}, expected = DEFAULT_EXPECTED_GITHUB_LOGINS) {
  const want = expected.map((s) => String(s).toLowerCase());
  if (status !== 200 || typeof login !== "string" || !login) {
    return {
      ok: false,
      code: 3,
      why: `GitHub identity unverifiable (GET /user -> HTTP ${status}) — refusing to write under an account nobody can name (ML-040, W-4)`,
    };
  }
  if (!want.includes(login.toLowerCase())) {
    return {
      ok: false,
      code: 1,
      why:
        `GitHub identity mismatch: this session writes as "${login}", expected one of [${want.join(", ")}] — ` +
        `refusing every write (ML-040). If this account is now correct, the operator changes DEFAULT_EXPECTED_GITHUB_LOGINS ` +
        `(workforce/scripts/lib/github-identity.mjs) or sets WF_GITHUB_EXPECTED_LOGINS`,
    };
  }
  return { ok: true, code: 0, why: `GitHub identity "${login}" is the expected account` };
}

/**
 * The preflight. `gh` is a raw `(method, path) => {status, json}` client (the
 * un-wrapped one inside makeGh, so this GET cannot recurse into itself).
 * Resolves on the expected identity; throws GithubIdentityError otherwise.
 */
export async function assertGithubIdentity(gh, { expected = expectedLogins(), log = (s) => console.error(s) } = {}) {
  let res;
  try {
    res = await gh("GET", "/user");
  } catch (e) {
    throw new GithubIdentityError(`GitHub identity unverifiable (${e?.msg || e?.message || e}) — refusing to write (ML-040, W-4)`, 3);
  }
  const verdict = identityVerdict({ status: res?.status, login: res?.json?.login }, expected);
  if (!verdict.ok) throw new GithubIdentityError(verdict.why, verdict.code);
  log(`github-identity: ${verdict.why} — proceeding (ML-040 preflight)`);
  return res.json.login;
}
