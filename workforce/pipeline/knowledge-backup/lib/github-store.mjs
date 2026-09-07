// Commit a batch of files to the knowledge-store repository as ONE commit,
// using the git data API (blobs -> tree -> commit -> ref).
//
// Why not the contents API (the shape the luckyhat-ms scrapers used): it is
// one HTTP round-trip and one commit PER FILE, and it forces the caller to do
// its own change detection (the Python scraper kept an MD5 cache for exactly
// this). Building a tree instead makes git do the diffing for us: if the tree
// we compose is byte-identical to the parent's tree, its SHA is identical too,
// and we skip the commit entirely. That is idempotency for free — re-running a
// day's backup produces no commit rather than an empty-diff one.

import { ensureProxyAwareEntry } from "../../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { requestJson } from "./http.mjs";

const API = "https://api.github.com";

function headers(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "ai-native-article-knowledge-backup",
    "content-type": "application/json",
  };
}

/**
 * Resolve the branch head. Returns null for a repository that exists but has
 * no commits yet (a freshly created knowledge store), which the caller turns
 * into a parentless initial commit.
 */
async function readHead(repo, branch, token) {
  try {
    const ref = await requestJson(`${API}/repos/${repo}/git/ref/heads/${branch}`, {
      headers: headers(token),
    });
    const commit = await requestJson(`${API}/repos/${repo}/git/commits/${ref.object.sha}`, {
      headers: headers(token),
    });
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
  } catch (err) {
    if (err.status === 404 || err.status === 409) return null;
    throw err;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.repo       "owner/name"
 * @param {string} opts.token      a token with `contents: write` on that repo
 * @param {string} opts.branch     target branch (created if the repo is empty)
 * @param {Array<{path: string, content: string}>} opts.files  files to write
 * @param {string} opts.message    commit message
 * @param {boolean} [opts.dryRun]  compose everything, commit nothing
 * @returns {Promise<{committed: boolean, sha?: string, reason?: string}>}
 */
export async function commitFiles({ repo, token, branch, files, message, dryRun = false }) {
  if (files.length === 0) return { committed: false, reason: "no files to write" };

  if (dryRun) {
    for (const f of files) console.log(`  [dry-run] would write ${f.path} (${f.content.length} chars)`);
    return { committed: false, reason: "dry run" };
  }

  const head = await readHead(repo, branch, token);

  // Blobs first: each returns a SHA the tree entry points at. Uploading a blob
  // whose content already exists is a no-op server-side that returns the same
  // SHA, so re-runs stay cheap.
  const entries = [];
  for (const file of files) {
    const blob = await requestJson(`${API}/repos/${repo}/git/blobs`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        content: Buffer.from(file.content, "utf8").toString("base64"),
        encoding: "base64",
      }),
    });
    entries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const tree = await requestJson(`${API}/repos/${repo}/git/trees`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(head ? { base_tree: head.treeSha, tree: entries } : { tree: entries }),
  });

  // The whole point of the tree approach: an unchanged day is a no-op.
  if (head && tree.sha === head.treeSha) {
    return { committed: false, reason: "content identical to HEAD" };
  }

  const commit = await requestJson(`${API}/repos/${repo}/git/commits`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: head ? [head.commitSha] : [],
    }),
  });

  if (head) {
    await requestJson(`${API}/repos/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      headers: headers(token),
      body: JSON.stringify({ sha: commit.sha }),
    });
  } else {
    await requestJson(`${API}/repos/${repo}/git/refs`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }

  return { committed: true, sha: commit.sha };
}
