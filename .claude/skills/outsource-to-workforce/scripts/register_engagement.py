#!/usr/bin/env python3
"""Register an agent-workforce engagement (step #4 of the outsourcing flow).

This is the deterministic, repetitive part of the flow — bundled so every run
posts the record identically instead of re-deriving the curl/urllib each time.

What it does:
  * reads the Bearer capability token from a .env file (default
    ~/work/asp-cloud/.env, key WF_ENGAGEMENT_WRITE_TOKEN) — never prints it;
  * auto-fills the mandatory ``skill_version`` from GET /skills/{name} unless
    given;
  * de-dup guard: refuses to post if the agent's portfolio for this project
    already has an engagement whose summary contains ``--dedup-key`` (e.g. the
    PR ref), unless ``--allow-duplicate`` is passed;
  * POSTs to /agents/{slug}/engagements and reports the engagement_id and
    whether the top-level ``summary`` persisted.

Auth/field mechanics it encodes (see references/workforce-api.md for the why):
  * Bearer tokens are scoped to ONE write path — the engagement token is NOT
    the feed token; a 401 means wrong/missing token, not a bad payload.
  * ``skill_version`` is REQUIRED (400 ``missing_fields`` otherwise).
  * top-level ``summary`` is the deliverable text; ``execution_surface`` is
    forced to ``client`` by the server regardless of what you send.
  * records are append-only (no PATCH) — a re-post is a new row, hence the guard.

Exit codes: 0 ok / created, 2 dedup hit (nothing posted), 3 missing token,
4 HTTP/validation error, 5 read-back verification failed (posted, but the
stored summary does not match what was sent — see below).

``summary`` is capped at 512 chars server-side (agents-api handler.ts hard-
slices it on write, mid-word, silently). #684: this script now (a) truncates
an over-long ``--summary`` itself, at a word boundary, with an explicit
"...[truncated]" marker, BEFORE posting, so a caller writing past the limit
sees exactly what was cut instead of losing the tail invisibly; and (b) reads
the row back after the POST and exits 5 (not 0) if the stored summary does
not match what this run actually sent — a 2xx only proves the endpoint
accepted *a* body, not *ours* (the same discipline the feed writers'
verifyReadBack() already applies; ML-020/R-18).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://workforce-api.kohuehara.xyz"
DEFAULT_ENV = os.path.expanduser("~/work/asp-cloud/.env")
TOKEN_KEY = "WF_ENGAGEMENT_WRITE_TOKEN"

# Skills the workforce has retired, mapped to the live skill that absorbed them.
# The engagements API does NOT validate skill_name (see references/workforce-api.md
# "Skill ownership is not enforced"), so a typo or a stale transcript will happily
# write a track-record row against a dead skill name. The `pr-review` reviewer skill
# was folded into `pr-autopilot` on 2026-06-17 (workforce adr-0010); crediting it is
# the exact mislabelling this guard exists to make impossible. Fail loud (C-4).
RETIRED_SKILLS = {
    "pr-review": "pr-autopilot",
    "pr-route": "pr-autopilot",
}

# Server-side cap on the top-level `summary` (agents-api handler.ts slices to
# this on write). Truncate here first, deliberately, so the loss is visible
# rather than an invisible mid-word server-side cut (#684).
SUMMARY_MAX = 512
TRUNCATION_MARKER = " ...[truncated]"


def truncate_summary(text: str, max_len: int = SUMMARY_MAX) -> tuple[str, bool]:
    """Cut an over-long summary at a word boundary and mark it. Pure/testable."""
    if len(text) <= max_len:
        return text, False
    budget = max_len - len(TRUNCATION_MARKER)
    cut = text[:budget]
    last_space = cut.rfind(" ")
    # Only back off to the word boundary if it doesn't throw away more than
    # half the budget (a single very long token should still get a hard cut).
    if last_space > budget * 0.5:
        cut = cut[:last_space]
    return cut + TRUNCATION_MARKER, True


def read_token(env_path: str) -> str:
    try:
        with open(env_path, encoding="utf-8") as fh:
            for line in fh:
                m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$", line)
                if m and m.group(1) == TOKEN_KEY:
                    return m.group(2).strip().strip('"').strip("'")
    except FileNotFoundError:
        return ""
    return ""


def _get(url: str):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


def skill_version(name: str) -> str | None:
    try:
        return _get(f"{BASE}/skills/{urllib.parse.quote(name)}").get("version")
    except Exception:
        return None


def portfolio(slug: str, project_id: str) -> list:
    try:
        q = urllib.parse.urlencode({"project_id": project_id})
        return _get(f"{BASE}/agents/{slug}/portfolio?{q}").get("items", [])
    except Exception:
        return []


def verify_read_back(slug: str, project_id: str, engagement_id: str, sent_summary: str) -> str | None:
    """Re-read the just-posted engagement and confirm the stored summary
    matches what this run sent (post caller-side truncation). Returns None on
    a verified match, or a message describing the failure otherwise. Mirrors
    the feed writers' verifyReadBack() (ML-020/R-18), ported to the
    engagement write path (#684): a 2xx proves the endpoint accepted *a*
    body, not *ours*.

    `/agents/{slug}/portfolio` reads via a GSI (agents-api handler.ts),
    which is not eligible for ConsistentRead — retry briefly before treating
    an absence as a failure rather than eventual-consistency noise.
    """
    attempts = 3
    for attempt in range(1, attempts + 1):
        items = portfolio(slug, project_id)
        row = next((it for it in items if it.get("engagement_id") == engagement_id), None)
        if row is not None:
            stored = row.get("summary") or ""
            if stored != sent_summary:
                return (f"read-back MISMATCH: engagement {engagement_id} does not carry the "
                        f"summary this run sent. sent={sent_summary[:120]!r} stored={stored[:120]!r}")
            return None
        if attempt < attempts:
            time.sleep(0.4 * attempt)
    return f"read-back: engagement {engagement_id} not found in the portfolio after {attempts} attempts"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Register a workforce engagement (flow step #4).")
    ap.add_argument("--slug", required=True, help="agent slug, e.g. ren")
    ap.add_argument("--project-id", required=True, help="client project, e.g. asp-cloud")
    ap.add_argument("--skill-name", required=True, help="engagement skill, e.g. pr-autopilot")
    ap.add_argument("--skill-version", default=None, help="auto-fetched from /skills if omitted")
    ap.add_argument("--status", default="ok", choices=["ok", "throw", "skipped"])
    ap.add_argument("--started-at", required=True, help="ISO-8601 Z")
    ap.add_argument("--ended-at", required=True, help="ISO-8601 Z")
    ap.add_argument("--summary", required=True, help="top-level deliverable text (persisted)")
    ap.add_argument("--dedup-key", default=None,
                    help="if a prior engagement summary contains this, skip (unless --allow-duplicate)")
    ap.add_argument("--allow-duplicate", action="store_true", help="post even if dedup-key matches")
    ap.add_argument("--env", default=DEFAULT_ENV, help=f"path to .env (default {DEFAULT_ENV})")
    args = ap.parse_args(argv)

    replacement = RETIRED_SKILLS.get(args.skill_name)
    if replacement:
        print(f"ERROR: '{args.skill_name}' is a RETIRED workforce skill — registering it "
              f"writes a track-record row against a dead skill name. It was folded into "
              f"'{replacement}' (workforce adr-0010, 2026-06-17). Re-run with "
              f"--skill-name {replacement}. See profiles/pr-autopilot.md.", file=sys.stderr)
        return 4

    tok = read_token(args.env)
    if not tok:
        print(f"ERROR: {TOKEN_KEY} not found in {args.env}. The engagement-write Bearer "
              f"token is provisioned out-of-band into .env by the operator — see "
              f"references/workforce-api.md.", file=sys.stderr)
        return 3
    print(f"token loaded: length={len(tok)} (value hidden)")

    ver = args.skill_version or skill_version(args.skill_name)
    if not ver:
        print(f"ERROR: could not resolve skill_version for '{args.skill_name}' "
              f"(GET /skills/{args.skill_name}); pass --skill-version.", file=sys.stderr)
        return 4

    # #684: truncate deliberately, at a word boundary, BEFORE the server ever
    # sees an over-long string — its own 512-char slice is silent and
    # mid-word, so relying on it loses the tail invisibly.
    summary, did_truncate = truncate_summary(args.summary)
    if did_truncate:
        print(f"WARNING: --summary is {len(args.summary)} chars, over the server's "
              f"{SUMMARY_MAX}-char cap — truncated at a word boundary with a marker before "
              f"sending (was going to be silently cut mid-word otherwise). Stored text: "
              f"{summary!r}", file=sys.stderr)

    if args.dedup_key and not args.allow_duplicate:
        for it in portfolio(args.slug, args.project_id):
            if args.dedup_key in (it.get("summary") or ""):
                print(f"DEDUP: {args.slug} already has an engagement referencing "
                      f"'{args.dedup_key}' ({it.get('engagement_id')}). Nothing posted. "
                      f"Pass --allow-duplicate to post anyway.")
                return 2

    payload = {
        "project_id": args.project_id,
        "skill_name": args.skill_name,
        "skill_version": ver,
        "started_at": args.started_at,
        "ended_at": args.ended_at,
        "status": args.status,
        "summary": summary,
    }
    req = urllib.request.Request(
        f"{BASE}/agents/{args.slug}/engagements",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json",
                 "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            body = json.load(r)
        eng = body.get("engagement", body)
        engagement_id = eng.get("engagement_id")

        # #684: a 2xx proves the endpoint accepted *a* body, not *ours*. Read
        # the row back (a fresh GET, not the POST's own echo) before
        # reporting success — the same discipline the feed writers already
        # apply (ML-020/R-18), now ported here.
        mismatch = None
        if engagement_id:
            mismatch = verify_read_back(args.slug, args.project_id, engagement_id, summary)
        else:
            mismatch = "read-back: POST response carried no engagement_id, cannot verify"

        if mismatch:
            print(f"ERROR {mismatch}", file=sys.stderr)
            print(f"(POSTED but NOT verified: {args.slug} [{args.skill_name} v{ver}] -> "
                  f"{engagement_id}; the row was accepted but this run could not confirm the "
                  f"stored summary matches what was sent.)", file=sys.stderr)
            return 5

        print(f"OK {args.slug} [{args.skill_name} v{ver}] -> {engagement_id} "
              f"| read-back verified (summary matches what was sent)")
        return 0
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]
        hint = " (401 = wrong/missing engagement token — it is scoped to one path, " \
               "the feed token will NOT work here)" if e.code == 401 else ""
        print(f"ERROR HTTP {e.code}{hint}: {detail}", file=sys.stderr)
        return 4
    except Exception as e:  # noqa: BLE001
        print(f"ERROR {type(e).__name__}: {e}", file=sys.stderr)
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
