import { ensureProxyAwareEntry } from "../../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { commitFiles } from "./github-store.mjs";

/** Route a stubbed fetch by method+path suffix. */
function stubFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push({ method, url, body: options.body ? JSON.parse(options.body) : null });
    for (const [pattern, respond] of routes) {
      const [m, suffix] = pattern.split(" ");
      if (m === method && url.includes(suffix)) {
        const value = typeof respond === "function" ? respond(calls.at(-1)) : respond;
        return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(value) };
      }
    }
    return { ok: false, status: 404, headers: new Headers(), text: async () => "{}" };
  };
  mock.method(globalThis, "fetch", impl);
  return calls;
}

const base = { repo: "o/r", token: "t", branch: "main", message: "m" };
const files = [{ path: "a.md", content: "hello" }];

test("skips the write entirely when there are no files", async () => {
  const result = await commitFiles({ ...base, files: [] });
  assert.deepEqual(result, { committed: false, reason: "no files to write" });
});

test("dry run composes nothing and touches no network", async () => {
  const calls = stubFetch([]);
  const result = await commitFiles({ ...base, files, dryRun: true });
  assert.equal(result.committed, false);
  assert.equal(calls.length, 0);
  mock.restoreAll();
});

test("an unchanged tree produces no commit", async () => {
  const calls = stubFetch([
    ["GET git/ref/heads/main", { object: { sha: "head" } }],
    ["GET git/commits/head", { tree: { sha: "tree-1" } }],
    ["POST git/blobs", { sha: "blob-1" }],
    // Server returns the SAME tree sha -> content is identical to HEAD.
    ["POST git/trees", { sha: "tree-1" }],
  ]);
  const result = await commitFiles({ ...base, files });
  assert.deepEqual(result, { committed: false, reason: "content identical to HEAD" });
  assert.ok(!calls.some((c) => c.url.includes("git/commits") && c.method === "POST"));
  mock.restoreAll();
});

test("a changed tree makes one commit and fast-forwards the ref", async () => {
  const calls = stubFetch([
    ["GET git/ref/heads/main", { object: { sha: "head" } }],
    ["GET git/commits/head", { tree: { sha: "tree-1" } }],
    ["POST git/blobs", { sha: "blob-1" }],
    ["POST git/trees", { sha: "tree-2" }],
    ["POST git/commits", { sha: "commit-2" }],
    ["PATCH git/refs/heads/main", {}],
  ]);
  const result = await commitFiles({
    ...base,
    files: [...files, { path: "b.md", content: "world" }],
  });
  assert.deepEqual(result, { committed: true, sha: "commit-2" });

  // Two blobs, exactly one tree, exactly one commit, exactly one ref update.
  assert.equal(calls.filter((c) => c.url.includes("git/blobs")).length, 2);
  assert.equal(calls.filter((c) => c.url.includes("git/trees")).length, 1);
  assert.equal(calls.filter((c) => c.method === "POST" && c.url.includes("git/commits")).length, 1);

  const treeCall = calls.find((c) => c.url.includes("git/trees"));
  assert.equal(treeCall.body.base_tree, "tree-1");
  assert.deepEqual(
    treeCall.body.tree.map((e) => e.path),
    ["a.md", "b.md"],
  );
  const commitCall = calls.find((c) => c.method === "POST" && c.url.includes("git/commits"));
  assert.deepEqual(commitCall.body.parents, ["head"]);
  mock.restoreAll();
});

test("an empty repository gets a parentless initial commit and a created ref", async () => {
  const calls = stubFetch([
    // No ref yet -> the 404 fallthrough in stubFetch models an empty repo.
    ["POST git/blobs", { sha: "blob-1" }],
    ["POST git/trees", { sha: "tree-1" }],
    ["POST git/commits", { sha: "commit-1" }],
    ["POST git/refs", {}],
  ]);
  const result = await commitFiles({ ...base, files });
  assert.deepEqual(result, { committed: true, sha: "commit-1" });

  const treeCall = calls.find((c) => c.url.includes("git/trees"));
  assert.equal(treeCall.body.base_tree, undefined);
  const commitCall = calls.find((c) => c.method === "POST" && c.url.includes("git/commits"));
  assert.deepEqual(commitCall.body.parents, []);
  assert.ok(calls.some((c) => c.method === "POST" && c.url.endsWith("/git/refs") && c.body.ref === "refs/heads/main"));
  mock.restoreAll();
});

test("blob content is base64-encoded UTF-8", async () => {
  const calls = stubFetch([
    ["GET git/ref/heads/main", { object: { sha: "head" } }],
    ["GET git/commits/head", { tree: { sha: "tree-1" } }],
    ["POST git/blobs", { sha: "blob-1" }],
    ["POST git/trees", { sha: "tree-2" }],
    ["POST git/commits", { sha: "commit-2" }],
    ["PATCH git/refs/heads/main", {}],
  ]);
  await commitFiles({ ...base, files: [{ path: "ja.md", content: "日本語" }] });
  const blobCall = calls.find((c) => c.url.includes("git/blobs"));
  assert.equal(blobCall.body.encoding, "base64");
  assert.equal(Buffer.from(blobCall.body.content, "base64").toString("utf8"), "日本語");
  mock.restoreAll();
});
