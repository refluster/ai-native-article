// workforce/lambdas/shared/messaging.ts
//
// Talent-messaging THREAD row family + read helpers (Epic-013 Story 1, #248).
//
// Mirrors the posture of shared/post.ts (Epic-011): the runtime *shape*
// lives here so the agents-api handler does not depend on a skill-folder
// handler. Story 1 is read-only — the write path (createThread /
// sendMessage) and the operator Bearer gate land in Story 2 (#249); the
// reply loop in Story 3 (#250).
//
// Row family (catalogued in workforce/docs/data-model.md):
//   THREAD#{id} / META          — thread descriptor
//   THREAD#{id} / MSG#{ulid}    — one message (operator or talent)
//   THREAD#{id} / PART#{slug}   — per-participant inbox/unread row (GSI4)
//
// GSI4 (`gsi4pk="INBOX#{slug}"`, `gsi4sk=last_message_at`) makes "list my
// threads, newest first, with unread badges" a single partition query.
// The PART# row denormalises the thread summary (participants, group,
// starred, last-message preview) so the inbox endpoint needs no per-thread
// META/MSG fan-out — see the Story 1 decision-delta on tracker #247.
//
// CLAUDE.md / W-4 (fail-loud): a row whose `body_ref` does not resolve in
// S3 is a messaging-health violation, so the body fetch throws rather than
// returning a silent partial.

import {
  getItem,
  queryBySkPrefix,
  queryByGsiPaged,
  type PagedResult,
} from "./ddb.js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const BUCKET_NAME = process.env.BUCKET_NAME;
const s3 = new S3Client({});

/** The human operator's pseudo-slug. Mirrors the SPA's OPERATOR_ID
 *  (apps/workforce/src/lib/messages.ts) so message `from` / inbox keys
 *  line up across the wire. */
export const MESSAGING_OPERATOR_ID = "operator";

/** Inline-preview cap on a message body (data-model.md §Thread rows). A
 *  body at or under this length is fully contained in `body_preview` and
 *  needs no S3 round-trip. */
export const MESSAGE_PREVIEW_MAX_CHARS = 320;

// --- Row types -----------------------------------------------------------

/** `THREAD#{id}` / `META` — the thread descriptor. `starred` is
 *  operator-scoped (C-3 single-operator) and mirrored onto the operator's
 *  PART# row for the single-query inbox filter. */
export interface ThreadMetaRow {
  pk: `THREAD#${string}`;
  sk: "META";
  thread_id: string;
  /** Talent slugs in the thread; the operator is implicit. */
  participants: string[];
  group: boolean;
  group_label?: string;
  /** `operator` | talent slug. v1 always `operator` (operator-initiated). */
  created_by: string;
  created_at: string;
  /** Denormalised for inbox sort; equals the GSI4 sort key on PART# rows. */
  last_message_at: string;
  starred: boolean;
}

/** `THREAD#{id}` / `MSG#{ulid}` — one message. */
export interface ThreadMessageRow {
  pk: `THREAD#${string}`;
  sk: `MSG#${string}`;
  thread_id: string;
  /** Talent slug, or MESSAGING_OPERATOR_ID. */
  from: string;
  at: string;
  /** First ≤320 chars of the body — cheap to read without S3. */
  body_preview: string;
  /** S3 key under `messages/{thread_id}/{ulid}.md`; absent when the whole
   *  body fit into `body_preview`. */
  body_ref?: string;
  /** LLM stop_reason for talent messages; absent for operator messages. */
  finish_reason?: string;
  tokens_in?: number;
  tokens_out?: number;
  /** messaging-reply version that authored a talent message (Story 3). */
  skill_version?: string;
}

/** `THREAD#{id}` / `PART#{slug}` — per-participant inbox row. Carries the
 *  denormalised thread summary so `GET /threads` is one GSI4 query. */
export interface ThreadPartRow {
  pk: `THREAD#${string}`;
  sk: `PART#${string}`;
  thread_id: string;
  /** The participant this row belongs to (talent slug or operator). */
  participant: string;
  unread: number;
  last_read_at?: string;
  // --- denormalised thread summary (kept in sync by the write path) ---
  participants: string[];
  group: boolean;
  group_label?: string;
  starred: boolean;
  last_message_at: string;
  last_message_from: string;
  last_message_preview: string;
  // --- GSI4 inbox projection ---
  gsi4pk: `INBOX#${string}`;
  gsi4sk: string;
}

// --- API view types ------------------------------------------------------

/** Summary shape for the inbox list (`GET /threads`). */
export interface ThreadSummaryView {
  thread_id: string;
  participants: string[];
  group: boolean;
  group_label?: string;
  starred: boolean;
  unread: number;
  last_message: {
    from: string;
    at: string;
    preview: string;
  };
}

/** One message in a thread detail view. `body` is fully resolved (preview
 *  inline, or S3-hydrated for long bodies). */
export interface ThreadMessageView {
  message_id: string;
  from: string;
  at: string;
  body: string;
}

/** Detail shape for one thread (`GET /threads/{id}`). */
export interface ThreadDetailView {
  thread_id: string;
  participants: string[];
  group: boolean;
  group_label?: string;
  starred: boolean;
  created_by: string;
  created_at: string;
  messages: ThreadMessageView[];
}

// --- Key + id helpers ----------------------------------------------------

export function threadPk(threadId: string): `THREAD#${string}` {
  return `THREAD#${threadId}`;
}

export function messageIdFromSk(sk: string): string {
  return sk.startsWith("MSG#") ? sk.slice("MSG#".length) : sk;
}

export function inboxGsiPk(slug: string): `INBOX#${string}` {
  return `INBOX#${slug}`;
}

// --- Row → view ----------------------------------------------------------

export function toThreadSummaryView(row: ThreadPartRow): ThreadSummaryView {
  return {
    thread_id: row.thread_id,
    participants: row.participants,
    group: row.group,
    ...(row.group_label !== undefined ? { group_label: row.group_label } : {}),
    starred: row.starred,
    unread: row.unread,
    last_message: {
      from: row.last_message_from,
      at: row.last_message_at,
      preview: row.last_message_preview,
    },
  };
}

// --- Read helpers --------------------------------------------------------

export type ThreadFilter = "unread" | "starred";

export interface ListInboxFilter {
  /** Whose inbox — talent slug or MESSAGING_OPERATOR_ID. */
  slug: string;
  cursor?: string;
  pageSize: number;
  filter?: ThreadFilter;
}

/**
 * Reverse-chronological inbox for one participant.
 *
 * Implementation: GSI4 partition query (`gsi4pk="INBOX#{slug}"`) with
 * `ScanIndexForward=false` so the most-recently-active threads come first.
 * The `unread` / `starred` filters post-filter the page (single-operator
 * scale: the inbox is small, so a client-shaped filter over the latest
 * page is adequate — see Epic-013 §Behaviour at N=100).
 */
export async function listInbox(
  filter: ListInboxFilter,
): Promise<PagedResult<ThreadPartRow>> {
  const page = await queryByGsiPaged<ThreadPartRow>("GSI4", inboxGsiPk(filter.slug), {
    limit: filter.pageSize,
    scanIndexForward: false,
    cursor: filter.cursor,
  });
  const items = page.items.filter((row) => {
    if (filter.filter === "unread" && row.unread <= 0) return false;
    if (filter.filter === "starred" && !row.starred) return false;
    return true;
  });
  return { items, cursor: page.cursor };
}

/** Fetch the META row for a thread, or `undefined` if it does not exist. */
export async function getThreadMeta(threadId: string): Promise<ThreadMetaRow | undefined> {
  return getItem<ThreadMetaRow>(threadPk(threadId), "META");
}

/**
 * Assemble the full thread detail — META + every message in chronological
 * order (oldest first, the natural reading order), with each message body
 * resolved (inline preview when short, S3 hydration when long).
 *
 * Returns `undefined` when the thread has no META row. Throws if a message
 * row references an S3 body that does not resolve (W-4).
 */
export async function getThreadDetail(threadId: string): Promise<ThreadDetailView | undefined> {
  const meta = await getThreadMeta(threadId);
  if (!meta) return undefined;

  // MSG#{ulid} sorts chronologically (ULID is time-ordered); ascending =
  // oldest first, which is the order the thread reads top-to-bottom.
  const rows = await queryBySkPrefix<ThreadMessageRow>(threadPk(threadId), "MSG#", 200);
  const messages: ThreadMessageView[] = [];
  for (const row of rows) {
    messages.push({
      message_id: messageIdFromSk(row.sk),
      from: row.from,
      at: row.at,
      body: await resolveMessageBody(row),
    });
  }

  return {
    thread_id: meta.thread_id,
    participants: meta.participants,
    group: meta.group,
    ...(meta.group_label !== undefined ? { group_label: meta.group_label } : {}),
    starred: meta.starred,
    created_by: meta.created_by,
    created_at: meta.created_at,
    messages,
  };
}

/**
 * Resolve a message body: the inline `body_preview` when the whole body
 * fit (no `body_ref`), otherwise the full text from S3. Skipping the S3
 * round-trip on short messages is the common case — most work-register
 * messages are well under the preview cap.
 */
export async function resolveMessageBody(row: ThreadMessageRow): Promise<string> {
  if (!row.body_ref) return row.body_preview;
  return fetchMessageBody(row.body_ref);
}

/**
 * Fetch a full message body from S3. Throws on a missing object (W-4) —
 * a row whose `body_ref` 404s is a messaging-health violation, not a
 * silent partial response.
 */
export async function fetchMessageBody(bodyRef: string): Promise<string> {
  if (!BUCKET_NAME) {
    throw new Error("BUCKET_NAME env var is required to fetch message bodies");
  }
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: bodyRef }));
  if (!res.Body) {
    throw new Error(`message body not found in S3: ${bodyRef}`);
  }
  return await res.Body.transformToString();
}
