// citation-urls.mjs — "does every cited source actually resolve?" for a
// plain-text citation list (one source per line — title + URL).
//
// Issue #673: the podcast pipeline's mandatory-citation guard
// (podcast-script/publish-notion.mjs) checked exactly one thing — that the
// citations file was non-empty. A single stray character passed. This module
// adds the mechanical half of what the issue asks for: every URL named in the
// citations must resolve over the network. It does NOT verify that a citation
// supports the claim it is attached to (a semantic judgement, still the
// generating LLM's job, not a mechanical gate's) or that a platform's terms
// haven't since changed underneath an old citation (issue #673 item 3, a
// recurring watch, not a one-shot check at write time) — callers should state
// that scope explicitly alongside a passing verdict, per the issue's item 2
// ("the green verdict should say what it did not check").
//
// Kept host-agnostic and dependency-free like source-fetch.mjs: HEAD first
// (cheap, no body download), falling back to GET only when a server rejects
// HEAD outright (405/501 are common for exactly this reason).

import { ensureProxyAwareEntry } from "./proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

const DEFAULT_TIMEOUT_MS = 15_000;
// Trailing punctuation a sentence/markdown wraps a URL in, never part of it.
// ')' is deliberately absent here — see the balance check below, because a
// URL can legitimately end in its own ')' (e.g. a Wikipedia
// `.../wiki/Foo_(bar)` link) and a blind strip would truncate it.
const TRAILING_PUNCT = /[.,;:!?\]}'"]+$/;

/** Pull every http(s) URL out of free-form citation text, de-duplicated and
 *  stripped of trailing sentence punctuation a URL regex over-captures. */
export function extractCitationUrls(text) {
  const matches = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
  const cleaned = matches.map((u) => {
    let url = u.replace(TRAILING_PUNCT, "");
    // A trailing ')' is ambiguous: strip it only while it is NOT balanced by
    // an earlier '(' inside the URL itself — i.e. it's the sentence's
    // closing paren ("(see https://x.com/a)"), not part of the URL's path.
    while (url.endsWith(")") && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) {
      url = url.slice(0, -1);
    }
    return url;
  });
  return [...new Set(cleaned)];
}

async function resolves(url, { timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetchImpl(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (res.status === 405 || res.status === 501) {
      // Some servers (correctly) reject HEAD; GET is the honest fallback.
      res = await fetchImpl(url, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    return { url, ok: res.ok, status: res.status };
  } catch (err) {
    const timedOut = err?.name === "AbortError";
    return { url, ok: false, status: timedOut ? "timeout" : `error: ${err?.message ?? err}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify every URL cited in `text` actually resolves.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: string,
 *   checked: Array<{url: string, ok: boolean, status: number|string}>,
 * }>}
 */
export async function verifyCitationsResolve(text, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const urls = extractCitationUrls(text);
  if (urls.length === 0) {
    return { ok: false, reason: "no citation URL found in the citations text", checked: [] };
  }
  const checked = await Promise.all(urls.map((u) => resolves(u, { timeoutMs, fetchImpl })));
  const failed = checked.filter((c) => !c.ok);
  if (failed.length > 0) {
    const detail = failed.map((c) => `${c.url} (${c.status})`).join(", ");
    return { ok: false, reason: `${failed.length}/${checked.length} citation URL(s) do not resolve: ${detail}`, checked };
  }
  return { ok: true, checked };
}
