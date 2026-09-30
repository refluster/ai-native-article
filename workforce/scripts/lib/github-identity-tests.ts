// @ts-nocheck — the modules under test are dependency-free ESM scripts, not TS.
// Discovered by workforce/lambdas/vitest.config.mjs (`../scripts/**/*-tests.ts`).
//
// ML-040 (#777/#781): a CCR fire writes to GitHub as the routine owner whatever
// token it sends. These tests pin the ONE mechanical answer to "may this fire
// write?": the expected account passes, anything else — including an identity
// nobody can read — throws before the first write leaves the process.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXPECTED_GITHUB_LOGINS,
  GithubIdentityError,
  assertGithubIdentity,
  expectedLogins,
  identityCheckRequired,
  identityVerdict,
} from "./github-identity.mjs";
import { makeGh } from "../../skills/pr-autopilot/pr-merge.mjs";

describe("identityVerdict", () => {
  it("the operator's account — what every CCR fire writes as — passes", () => {
    expect(identityVerdict({ status: 200, login: "refluster" })).toMatchObject({ ok: true });
    expect(identityVerdict({ status: 200, login: "Refluster" })).toMatchObject({ ok: true });
  });

  it("any other account is a mismatch and says how the operator changes the set", () => {
    const v = identityVerdict({ status: 200, login: "someone-else" });
    expect(v).toMatchObject({ ok: false, code: 1 });
    expect(v.why).toMatch(/mismatch.*someone-else.*DEFAULT_EXPECTED_GITHUB_LOGINS/);
  });

  it("an identity nobody can read is not one to write under (W-4)", () => {
    expect(identityVerdict({ status: 401 })).toMatchObject({ ok: false, code: 3 });
    expect(identityVerdict({ status: 200, login: "" })).toMatchObject({ ok: false, code: 3 });
  });
});

describe("expectedLogins / identityCheckRequired", () => {
  it("defaults to the operator account", () => {
    expect(expectedLogins({})).toEqual([...DEFAULT_EXPECTED_GITHUB_LOGINS]);
  });

  it("the env override replaces the set (a local run under another account)", () => {
    expect(expectedLogins({ WF_GITHUB_EXPECTED_LOGINS: " Bot-A , bot-b " })).toEqual(["bot-a", "bot-b"]);
  });

  it("runs inside CCR, or when the operator opts in — never in Actions/Lambda by default", () => {
    expect(identityCheckRequired({ CLAUDE_CODE_REMOTE: "true" })).toBe(true);
    expect(identityCheckRequired({ WF_GITHUB_EXPECTED_LOGINS: "refluster" })).toBe(true);
    expect(identityCheckRequired({ GITHUB_ACTIONS: "true" })).toBe(false);
    expect(identityCheckRequired({})).toBe(false);
  });
});

describe("assertGithubIdentity", () => {
  it("resolves to the login on the expected account", async () => {
    const gh = vi.fn(async () => ({ status: 200, json: { login: "refluster" } }));
    await expect(assertGithubIdentity(gh, { log: () => {} })).resolves.toBe("refluster");
    expect(gh).toHaveBeenCalledWith("GET", "/user");
  });

  it("throws a GithubIdentityError carrying makeGh's {code, msg} shape", async () => {
    const gh = async () => ({ status: 200, json: { login: "intruder" } });
    const err = await assertGithubIdentity(gh, { log: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubIdentityError);
    expect(err.code).toBe(1);
    expect(err.msg).toMatch(/intruder/);
  });

  it("a network failure on the preflight is a refusal, not a pass", async () => {
    const gh = async () => {
      throw { code: 3, msg: "network error on GET /user" };
    };
    await expect(assertGithubIdentity(gh, { log: () => {} })).rejects.toMatchObject({ code: 3 });
  });
});

describe("makeGh gates the first write, never a read", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (login) => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        calls.push(`${init.method} ${new URL(url).pathname}`);
        const body = new URL(url).pathname === "/user" ? { login } : { ok: true };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    return calls;
  };

  it("one GET /user before the first write, shared by every later write", async () => {
    const calls = stubFetch("refluster");
    const gh = makeGh({ token: "t", api: "https://gh.test", identityCheck: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await gh("GET", "/repos/o/r/issues");
    await gh("POST", "/repos/o/r/issues/1/comments", { body: "x" });
    await gh("DELETE", "/repos/o/r/issues/1/labels/a");
    expect(calls).toEqual(["GET /repos/o/r/issues", "GET /user", "POST /repos/o/r/issues/1/comments", "DELETE /repos/o/r/issues/1/labels/a"]);
  });

  it("on a mismatch the write is never sent", async () => {
    const calls = stubFetch("intruder");
    const gh = makeGh({ token: "t", api: "https://gh.test", identityCheck: true });
    await expect(gh("POST", "/repos/o/r/issues/1/comments", { body: "x" })).rejects.toBeInstanceOf(GithubIdentityError);
    expect(calls).toEqual(["GET /user"]);
  });

  it("with the check off (Actions, Lambda, tests) the client is unchanged", async () => {
    const calls = stubFetch("anyone");
    const gh = makeGh({ token: "t", api: "https://gh.test", identityCheck: false });
    await gh("POST", "/repos/o/r/issues/1/comments", { body: "x" });
    expect(calls).toEqual(["POST /repos/o/r/issues/1/comments"]);
  });
});
