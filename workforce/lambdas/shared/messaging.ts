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
  putItem,
  queryBySkPrefix,
  queryBySkPrefixPaged,
  queryByGsiPaged,
  updateOperational,
  type PagedResult,
} from "./ddb.js";
import { newUlid } from "./task.js";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const BUCKET_NAME = process.env.BUCKET_NAME;
const s3 = new S3Client({});

/** Hard cap — beyond this a "message" is a mis-shaped document (Epic-013
 *  §1). Mirrors the feed post hard cap. */
export const MESSAGE_HARD_MAX_CHARS = 2000;

/** The human operator's pseudo-slug. Mirrors the SPA's OPERATOR_ID
 *  (workforce/app/src/lib/messages.ts) so message `from` / inbox keys
 *  line up across the wire. */
export const MESSAGING_OPERATOR_ID = "operator";

/** Inline-preview cap on a message body (data-model.md §Thread rows). A
 *  body at or under this length is fully contained in `body_preview` and
 *  needs no S3 round-trip. */
export const MESSAGE_PREVIEW_MAX_CHARS = 320;

/** Default page size for a thread-detail message page (Epic-024). The
 *  newest page opens the thread; older pages are cursor-walked on demand. */
export const THREAD_MESSAGES_PAGE_DEFAULT = 50;

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

/** Detail shape for one thread (`GET /threads/{id}`). `messages` is one
 *  page — the newest by default — in chronological order; `older_cursor`
 *  (when present) resumes the walk toward the start of the thread. */
export interface ThreadDetailView {
  thread_id: string;
  participants: string[];
  group: boolean;
  group_label?: string;
  starred: boolean;
  created_by: string;
  created_at: string;
  messages: ThreadMessageView[];
  older_cursor?: string;
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

/** Page selector for `getThreadDetail` — no cursor means the newest page. */
export interface ThreadMessagesPage {
  pageSize?: number;
  /** Opaque cursor from a previous page's `older_cursor`. */
  cursor?: string;
}

/**
 * Assemble one page of the thread detail — META + the newest `pageSize`
 * messages (or the page at `cursor`, walking toward the start of the
 * thread) in chronological order, each body resolved (inline preview when
 * short, S3 hydration when long). `older_cursor` is set while older
 * history remains.
 *
 * MSG#{ulid} sorts chronologically (ULID is time-ordered), so the query
 * runs DESCENDING and the page is reversed back to reading order. Querying
 * ascending with a Limit would keep the OLDEST page and silently drop the
 * newest once a thread outgrows the window — the engagement-ledger footgun
 * the queryBySkPrefix docstring warns about (Epic-024 gap 3).
 *
 * Returns `undefined` when the thread has no META row. Throws if a message
 * row references an S3 body that does not resolve (W-4).
 */
export async function getThreadDetail(
  threadId: string,
  page: ThreadMessagesPage = {},
): Promise<ThreadDetailView | undefined> {
  const meta = await getThreadMeta(threadId);
  if (!meta) return undefined;

  const rows = await queryBySkPrefixPaged<ThreadMessageRow>(
    threadPk(threadId),
    "MSG#",
    page.pageSize ?? THREAD_MESSAGES_PAGE_DEFAULT,
    page.cursor,
    false,
  );
  const messages: ThreadMessageView[] = [];
  for (const row of [...rows.items].reverse()) {
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
    ...(rows.cursor !== undefined ? { older_cursor: rows.cursor } : {}),
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

// --- Write path (Epic-013 Story 2, #249) --------------------------------
//
// Operator-authored writes. Authentication is enforced at the API Gateway
// layer (Cognito JWT authorizer, decision D3) before the handler runs, so
// these helpers trust the caller. They are the only write path for
// operator messages; talent messages come from the messaging-reply skill
// (Story 3) via sendMessage with a talent `from`.

/** Trim + validate a message body. Throws on empty or over-hard-cap (W-4 /
 *  C-4 fail-loud — a degenerate message must not land silently). */
function validateBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new Error("message: empty_body");
  if (trimmed.length > MESSAGE_HARD_MAX_CHARS) {
    throw new Error(`message: body_over_hard_cap: ${trimmed.length} > ${MESSAGE_HARD_MAX_CHARS}`);
  }
  return trimmed;
}

/** Write the full body to S3 when it exceeds the inline preview cap; return
 *  the S3 key, or undefined when the body fits inline (no round-trip). */
async function writeMessageBody(
  threadId: string,
  messageId: string,
  body: string,
): Promise<string | undefined> {
  if (body.length <= MESSAGE_PREVIEW_MAX_CHARS) return undefined;
  if (!BUCKET_NAME) throw new Error("BUCKET_NAME env var is required to store message bodies");
  const bodyRef = `messages/${threadId}/${messageId}.md`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: bodyRef,
      Body: body,
      ContentType: "text/markdown; charset=utf-8",
    }),
  );
  return bodyRef;
}

/** Apply the denormalised last-message summary + GSI4 sort key to a PART
 *  patch. Shared by createThread and sendMessage so the projection can
 *  never drift between the two write paths. */
function summaryPatch(from: string, preview: string, at: string) {
  return {
    last_message_from: from,
    last_message_preview: preview,
    last_message_at: at,
    gsi4sk: at,
  };
}

export interface CreateThreadInput {
  /** Talent slugs in the thread; the operator is implicit. */
  participants: string[];
  /** First message body. */
  body: string;
  /** Author of the first message. v1 always the operator. */
  from?: string;
  group_label?: string;
  now?: () => Date;
  newUlid?: () => string;
}

/**
 * Create a thread and its first message. Writes (in order): the S3 body
 * (if long) → META → first MSG → one PART row per participant (operator +
 * each talent). Returns the new `thread_id`.
 *
 * `group` is derived: more than one talent participant ⇒ group thread.
 * The author's PART starts read (`unread: 0`); every recipient's PART
 * starts at `unread: 1`.
 */
export async function createThread(input: CreateThreadInput): Promise<{ thread_id: string }> {
  const mkUlid = input.newUlid ?? newUlid;
  const now = (input.now ?? (() => new Date()))();
  const from = input.from ?? MESSAGING_OPERATOR_ID;
  const talents = input.participants;
  if (talents.length === 0) throw new Error("createThread: participants must be non-empty");

  const body = validateBody(input.body);
  const at = now.toISOString();
  const threadId = mkUlid();
  const messageId = mkUlid();
  const group = talents.length > 1;
  const preview = body.slice(0, MESSAGE_PREVIEW_MAX_CHARS);

  const bodyRef = await writeMessageBody(threadId, messageId, body);

  const meta: ThreadMetaRow = {
    pk: threadPk(threadId),
    sk: "META",
    thread_id: threadId,
    participants: talents,
    group,
    ...(input.group_label !== undefined ? { group_label: input.group_label } : {}),
    created_by: from,
    created_at: at,
    last_message_at: at,
    starred: false,
  };
  await putItem(meta);

  const msg: ThreadMessageRow = {
    pk: threadPk(threadId),
    sk: `MSG#${messageId}`,
    thread_id: threadId,
    from,
    at,
    body_preview: preview,
    ...(bodyRef !== undefined ? { body_ref: bodyRef } : {}),
  };
  await putItem(msg);

  // One PART row per participant (operator + each talent). The author's
  // row starts read; recipients start with one unread.
  const allParticipants = [MESSAGING_OPERATOR_ID, ...talents];
  for (const slug of allParticipants) {
    const part: ThreadPartRow = {
      pk: threadPk(threadId),
      sk: `PART#${slug}`,
      thread_id: threadId,
      participant: slug,
      unread: slug === from ? 0 : 1,
      ...(slug === from ? { last_read_at: at } : {}),
      participants: talents,
      group,
      ...(input.group_label !== undefined ? { group_label: input.group_label } : {}),
      starred: false,
      ...summaryPatch(from, preview, at),
      gsi4pk: inboxGsiPk(slug),
    };
    await putItem(part);
  }

  return { thread_id: threadId };
}

export interface SendMessageInput {
  thread_id: string;
  /** Author — operator slug, or a talent slug (Story 3 reply path). */
  from: string;
  body: string;
  finish_reason?: string;
  tokens_in?: number;
  tokens_out?: number;
  skill_version?: string;
  now?: () => Date;
  newUlid?: () => string;
}

/**
 * Append a message to an existing thread and fan the denormalised summary
 * out to every PART row. Recipients' `unread` increments; the author's
 * resets to 0 (sending implies reading). Throws if the thread has no META
 * row (W-4 — never create a dangling message).
 */
export async function sendMessage(input: SendMessageInput): Promise<{ message_id: string }> {
  const mkUlid = input.newUlid ?? newUlid;
  const now = (input.now ?? (() => new Date()))();

  const meta = await getThreadMeta(input.thread_id);
  if (!meta) throw new Error(`sendMessage: no thread META for ${input.thread_id}`);

  const body = validateBody(input.body);
  const at = now.toISOString();
  const messageId = mkUlid();
  const preview = body.slice(0, MESSAGE_PREVIEW_MAX_CHARS);
  const bodyRef = await writeMessageBody(input.thread_id, messageId, body);

  const msg: ThreadMessageRow = {
    pk: threadPk(input.thread_id),
    sk: `MSG#${messageId}`,
    thread_id: input.thread_id,
    from: input.from,
    at,
    body_preview: preview,
    ...(bodyRef !== undefined ? { body_ref: bodyRef } : {}),
    ...(input.finish_reason !== undefined ? { finish_reason: input.finish_reason } : {}),
    ...(input.tokens_in !== undefined ? { tokens_in: input.tokens_in } : {}),
    ...(input.tokens_out !== undefined ? { tokens_out: input.tokens_out } : {}),
    ...(input.skill_version !== undefined ? { skill_version: input.skill_version } : {}),
  };
  await putItem(msg);

  await updateOperational<ThreadMetaRow>(threadPk(input.thread_id), "META", { last_message_at: at });

  // Fan the summary out to every existing PART row. Read-modify-write the
  // unread counter (single-operator scale: no contention to lose to).
  const parts = await queryBySkPrefix<ThreadPartRow>(threadPk(input.thread_id), "PART#", 100);
  for (const part of parts) {
    const isAuthor = part.participant === input.from;
    await updateOperational<ThreadPartRow>(part.pk, part.sk, {
      ...summaryPatch(input.from, preview, at),
      unread: isAuthor ? 0 : part.unread + 1,
      ...(isAuthor ? { last_read_at: at } : {}),
    });
  }

  return { message_id: messageId };
}

/** Clear a participant's unread counter (thread opened). */
export async function markThreadRead(
  threadId: string,
  slug: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  await updateOperational<ThreadPartRow>(threadPk(threadId), `PART#${slug}`, {
    unread: 0,
    last_read_at: now().toISOString(),
  });
}

/**
 * Set the operator-scoped star flag on a thread. META is the source of
 * truth; the operator's PART row mirrors it so the inbox `?filter=starred`
 * stays a single GSI4 query (decision D1).
 */
export async function setThreadStar(threadId: string, starred: boolean): Promise<void> {
  await updateOperational<ThreadMetaRow>(threadPk(threadId), "META", { starred });
  await updateOperational<ThreadPartRow>(
    threadPk(threadId),
    `PART#${MESSAGING_OPERATOR_ID}`,
    { starred },
  );
}
