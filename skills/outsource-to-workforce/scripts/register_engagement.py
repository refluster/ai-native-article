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
4 HTTP/validation error.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://workforce-api.kohuehara.xyz"
DEFAULT_ENV = os.path.expanduser("~/work/asp-cloud/.env")
TOKEN_KEY = "WF_ENGAGEMENT_WRITE_TOKEN"


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


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Register a workforce engagement (flow step #4).")
    ap.add_argument("--slug", required=True, help="agent slug, e.g. ren")
    ap.add_argument("--project-id", required=True, help="client project, e.g. asp-cloud")
    ap.add_argument("--skill-name", required=True, help="engagement skill, e.g. pr-review")
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
        "summary": args.summary,
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
        persisted = bool((eng.get("summary") or "").strip())
        print(f"OK {args.slug} [{args.skill_name} v{ver}] -> {eng.get('engagement_id')} "
              f"| summary_persisted={'YES' if persisted else 'NO'}")
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
