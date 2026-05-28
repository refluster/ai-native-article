// workforce/lambdas/shared/post.ts
//
// Workforce activity-feed POST row family + read/hide helpers.
//
// Row family + GSI3 (`gsi3pk="FEED"`, `gsi3sk=posted_at`) are added by
// Epic-011 Story 1 (#128) / PR #149. The runtime *shape* lives here so
// the API handler (Epic-011 Story 5 / #132) does not depend on Story 1's
// skill-folder handler.ts which is not on the API Lambda's import graph.
//
// Per the Story 5 task brief, this file is the canonical home of:
//   - `FeedPostRow` type — the runtime row shape (matching PR #149)
//   - `FeedPostApiView` + `toFeedPostApiView()` — API-shaped view with
//     `body_preview` only; full body is hydrated by the detail endpoint
//   - `FeedPostDetailView` — adds `body` (full text) and resolves references
//   - read helpers — `listFeed`, `listAgentPosts`, `getPost`
//   - **`hidePost()` stub** — Epic-011 Story 4 (#131) owns the production
//     implementation. The stub throws so the API route compiles + tests
//     can assert "the hide-helper hasn't landed yet" rather than silently
//     succeed. Rename / fill in when #131 lands its helper.
//
// CLAUDE.md / C-4 (fail-loud): every load-bearing function throws on
// caller mistake (invalid post_id, missing row) rather than returning
// `null` and shifting the burden to the route layer.

import { getItem, queryByGsiPaged, queryBySkPrefixPaged, type PagedResult } from "./ddb.js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const BUCKET_NAME = process.env.BUCKET_NAME;
const s3 = new S3Client({});

// --- Types ---------------------------------------------------------------

export type PostKind = "reflection" | "friction" | "improvement" | "observation";

/** Workforce-internal POST row family — `AGENT#{slug}` / `POST#{ulid}`.
 *  Catalogued in workforce/docs/data-model.md (Epic-011 Story 1).
 *
 *  `visibility` is added by Epic-011 Story 4 (#131): default `workforce`
 *  if absent; `hidden` means the operator soft-removed the post via the
 *  hide primitive. The post body in S3 is never mutated — audit grade. */
export interface FeedPostRow {
  pk: `AGENT#${string}`;
  sk: `POST#${string}`;
  agent_slug: string;
  posted_at: string;
  kind: PostKind;
  /** S3 key under `posts/{slug}/{yyyy}/{mm}/{ulid}.md`. */
  body_ref: string;
  /** First ≤320 chars of the body. Cheap to read on the feed page
   *  without an S3 fetch. */
  body_preview: string;
  /** Up to 3 ULIDs of EXEC / DELIV / TASK rows the post references. */
  references: string[];
  finish_reason: string;
  tokens_in: number;
  tokens_out: number;
  skill_version: string;
  /** GSI3 partition key — `"FEED"` for every visible post. */
  gsi3pk: "FEED";
  /** GSI3 sort key — `posted_at` so reverse-chrono pagination is a
   *  partition range query with `ScanIndexForward=false`. */
  gsi3sk: string;
  /** Epic-011 Story 4 (#131) — `workforce` (default) | `hidden`. Absence
   *  is treated as `workforce` by every consumer. */
  visibility?: "workforce" | "hidden";
}

/** A single reference rendered on the feed card.
 *  `accessible=false` is the greyed-out chip case from Epic-011 §6 —
 *  v1 always returns `true` because cross-project visibility checks
 *  belong to Epic-010 and are not wired through the public feed API. */
export interface ReferenceView {
  /** Discriminator from the ULID prefix: `EXEC` / `DELIV` / `TASK`.
   *  Unknown shapes fall through to `"other"`. */
  type: "EXEC" | "DELIV" | "TASK" | "other";
  id: string;
  accessible: boolean;
}

/** API-shaped feed post for the list endpoints (`/feed`, `/agents/{slug}/posts`).
 *  Carries `body_preview` only; the SPA hydrates full body via `/feed/{post_id}`. */
export interface FeedPostApiView {
  post_id: string;
  agent_slug: string;
  posted_at: string;
  kind: PostKind;
  body_preview: string;
  references: ReferenceView[];
  /** Omitted on visible posts (the common case); set to `"hidden"` when
   *  the row was admitted by `?include_hidden=true`. The operator UI uses
   *  this to render a "hidden" badge. */
  visibility?: "hidden";
}

/** Detail-view shape — `GET /feed/{post_id}`. Adds the full body text
 *  (S3 fetch) on top of the list view. */
export interface FeedPostDetailView extends FeedPostApiView {
  body: string;
}

// --- Row → view ----------------------------------------------------------

/** Extract the ulid suffix from a `POST#{ulid}` sort key. */
export function postIdFromSk(sk: string): string {
  return sk.startsWith("POST#") ? sk.slice("POST#".length) : sk;
}

/** Discriminate reference type by the row family prefix encoded into the
 *  reference string. The runner-side `feed-post` handler emits raw ULIDs
 *  in `references[]` (per PR #149 SKILL.md), so a literal prefix is the
 *  only signal we have at API time.
 *
 *  Conventions:
 *    - `EXEC#{ulid}` → exec
 *    - `DELIV#{ulid}` → deliv
 *    - `TASK#{ulid}` → task
 *    - anything else → `"other"` (renders without a chip type but is
 *      still clickable via the bare id)
 *
 *  Bare ULIDs (no prefix) currently classify as `"other"`. If Story 7
 *  (SPA wiring) needs a stronger contract, tighten the SKILL.md prompt
 *  to require the prefix and add a write-time validator. */
function classifyReference(ref: string): ReferenceView {
  let type: ReferenceView["type"];
  let id = ref;
  if (ref.startsWith("EXEC#")) {
    type = "EXEC";
    id = ref.slice("EXEC#".length);
  } else if (ref.startsWith("DELIV#")) {
    type = "DELIV";
    id = ref.slice("DELIV#".length);
  } else if (ref.startsWith("TASK#")) {
    type = "TASK";
    id = ref.slice("TASK#".length);
  } else {
    type = "other";
  }
  // v1: `accessible` is hard-coded `true`. Cross-project visibility
  // checks belong to Epic-010 and the read-gate isn't wired through
  // the public feed API yet (see Story 5 task brief).
  return { type, id, accessible: true };
}

export function toFeedPostApiView(row: FeedPostRow): FeedPostApiView {
  const view: FeedPostApiView = {
    post_id: postIdFromSk(row.sk),
    agent_slug: row.agent_slug,
    posted_at: row.posted_at,
    kind: row.kind,
    body_preview: row.body_preview,
    references: (row.references ?? []).map(classifyReference),
  };
  if (row.visibility === "hidden") view.visibility = "hidden";
  return view;
}

// --- Read helpers --------------------------------------------------------

export interface ListFeedFilter {
  cursor?: string;
  /** Page size; defaulted + clamped by the route layer. */
  pageSize: number;
  kind?: PostKind;
  agentSlug?: string;
  /** Inclusive lower bound on `posted_at` (ISO). */
  from?: string;
  /** Inclusive upper bound on `posted_at`. */
  to?: string;
  includeHidden?: boolean;
}

/** Reverse-chronological feed across all agents.
 *
 *  Implementation: GSI3 partition query (`gsi3pk="FEED"`) with
 *  `ScanIndexForward=false` so the latest posts come first. The
 *  `from`/`to` bounds push down to the index sort key (`gsi3sk=posted_at`).
 *
 *  Note on filter semantics: `kind` + `agent_slug` post-filter the page.
 *  At the v1 corpus shape (17 agents × ≤1 post/day), the page-after-
 *  post-filter shape is acceptable. If filter precision becomes a
 *  concern (a page returning <pageSize items because half were filtered
 *  out), the v2 surface is a second sort-key shape in the row family —
 *  see data-model.md §GSI3 commentary.
 *
 *  Hidden-post filter (Epic-011 Story 4 / #131): `visibility === "hidden"`
 *  is dropped by default. `?include_hidden=true` (operator-only) admits
 *  hidden rows in-list with `visibility: "hidden"` carried through to
 *  the API view so the renderer can badge them. */
export async function listFeed(filter: ListFeedFilter): Promise<PagedResult<FeedPostRow>> {
  const page = await queryByGsiPaged<FeedPostRow>("GSI3", "FEED", {
    skGte: filter.from,
    skLte: filter.to,
    limit: filter.pageSize,
    scanIndexForward: false,
    cursor: filter.cursor,
  });
  const items = page.items.filter((row) => {
    if (filter.kind && row.kind !== filter.kind) return false;
    if (filter.agentSlug && row.agent_slug !== filter.agentSlug) return false;
    if (!filter.includeHidden && row.visibility === "hidden") return false;
    return true;
  });
  return { items, cursor: page.cursor };
}

export interface ListAgentPostsFilter {
  agentSlug: string;
  cursor?: string;
  pageSize: number;
  kind?: PostKind;
  from?: string;
  to?: string;
  includeHidden?: boolean;
}

/** Per-agent reverse-chronological feed.
 *
 *  Implementation: partition query on `pk=AGENT#{slug}` with sort-key
 *  prefix `POST#` and `ScanIndexForward=false`. Doesn't need GSI3 —
 *  the agent partition is naturally bounded to that agent's posts.
 *
 *  Range filters on `from`/`to` are post-filtered (the sort key is a
 *  ULID, not the raw timestamp, so we can't push the range down on this
 *  path). Acceptable at v1 cadence; if it gets hot, add a per-agent
 *  GSI keyed by `posted_at` (Story 5+/follow-up). */
export async function listAgentPosts(
  filter: ListAgentPostsFilter,
): Promise<PagedResult<FeedPostRow>> {
  const page = await queryBySkPrefixPaged<FeedPostRow>(
    `AGENT#${filter.agentSlug}`,
    "POST#",
    filter.pageSize,
    filter.cursor,
    false, // descending — newest first
  );
  const items = page.items.filter((row) => {
    if (filter.kind && row.kind !== filter.kind) return false;
    if (filter.from && row.posted_at < filter.from) return false;
    if (filter.to && row.posted_at > filter.to) return false;
    if (!filter.includeHidden && row.visibility === "hidden") return false;
    return true;
  });
  return { items, cursor: page.cursor };
}

/** Fetch a single POST row by `(agent_slug, post_id)`. Returns `undefined`
 *  when no row exists at that key.
 *
 *  Hidden posts are returned by this helper: the route layer chooses
 *  whether to surface them (Epic-011 §6 hides them from default lists
 *  but the detail endpoint preserves the audit trail). */
export async function getPost(
  agentSlug: string,
  postId: string,
): Promise<FeedPostRow | undefined> {
  return getItem<FeedPostRow>(`AGENT#${agentSlug}`, `POST#${postId}`);
}

/** Resolve the post body from S3.
 *
 *  Bodies under ≤320 chars are entirely contained in `body_preview`, so
 *  the detail endpoint can skip the S3 round-trip on short posts. The
 *  route layer makes that decision; this helper unconditionally fetches.
 *
 *  Throws on S3 failure (W-4): the operator's expectation is that a row
 *  whose `body_ref` doesn't resolve is a `feed-health` violation, not a
 *  silent partial response. */
export async function fetchPostBody(bodyRef: string): Promise<string> {
  if (!BUCKET_NAME) {
    throw new Error("BUCKET_NAME env var is required to fetch post bodies");
  }
  const res = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: bodyRef }),
  );
  if (!res.Body) {
    throw new Error(`post body not found in S3: ${bodyRef}`);
  }
  return await res.Body.transformToString();
}

// --- Mutation ------------------------------------------------------------

export interface HidePostInput {
  agent_slug: string;
  post_id: string;
  /** Operator-supplied reason — non-empty. Stored on the audit `EXEC` row
   *  written by Story 4's helper. */
  reason: string;
  /** Subject identifier of the IAM principal that authorised the hide.
   *  Surfaces on the audit row's `agent_slug` slot (`_operator` for
   *  IAM-authed humans). */
  operator: string;
}

/**
 * Operator-only hide primitive — flips `visibility=hidden` on the POST
 * row and writes a PROJECT-scoped audit `EXEC` row.
 *
 * **Stubbed in this PR**: Epic-011 Story 4 (#131) owns the implementation.
 * The Story 5 PR (#132) wires the call site so the API route compiles
 * and the rejection-path tests can assert "no helper means a throw, not
 * a silent success." When Story 4 lands its helper, rename + delete the
 * stub — the call site signature is the contract.
 *
 * Contract per #131:
 *   1. Write the audit EXEC row FIRST (W-2 ordering: audit-then-mutate,
 *      never the reverse).
 *   2. Then flip `visibility=hidden` on the POST row.
 *   3. The body in S3 is NEVER mutated.
 */
export async function hidePost(_input: HidePostInput): Promise<void> {
  // TODO(story-4-#131): wire to the real `hidePost()` helper — this stub
  // throws until Story 4 lands. Tests assert this throw to lock the
  // sequencing contract: a `PATCH /feed/{post_id}` issued before #131
  // lands fails loudly rather than silently no-oping.
  throw new Error("hide_helper_not_wired");
}
