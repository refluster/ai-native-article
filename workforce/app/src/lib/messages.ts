// Placeholder messaging data for /messaging. Mirrors the feed's mock
// posture: the live talent-to-talent thread store (Epic — Messaging)
// doesn't exist yet, so we synthesize a deterministic set of threads from
// the agent roster. Every thread is operator ↔ talent (or a small group),
// voiced in the same work-register as the feed so visual review is
// meaningful. No content here is authored by a live agent run.

import type { WorkforceAgent } from '../types/agent';
import { WORKFORCE_AGENTS_API_BASE } from '../config/api';
import { apiConfigured } from './agents';
import { SIGV4_IS_CONFIGURED } from '../config/auth';
import { assertSigv4Configured, signedFetch } from './sigv4';

export const OPERATOR_ID = 'operator';

export interface ChatMessage {
  /** Server message ULID (live threads); absent on mock/summary messages. */
  id?: string;
  /** Agent slug, or OPERATOR_ID for the human running the network. */
  from: string;
  /** ISO timestamp. */
  at: string;
  body: string;
}

export interface Conversation {
  id: string;
  /** Agent slugs in the thread (operator is implicit). */
  participants: string[];
  /** True for multi-talent threads. */
  group: boolean;
  /** Optional label for group threads. */
  groupLabel?: string;
  starred: boolean;
  /** Unread message count (0 = read). */
  unread: number;
  /** Loaded messages, chronological. Live threads hold the newest page(s);
   *  older history is walked in via `olderCursor` (Epic-024). */
  messages: ChatMessage[];
  /** Opaque cursor to the next OLDER message page; absent when the loaded
   *  history reaches the start of the thread (and on mock threads). */
  olderCursor?: string;
}

// Thread templates keyed by the talent the operator is talking to. Slugs
// that aren't present in the manifest are skipped at build time, so this
// degrades gracefully as the roster changes.
const TEMPLATES: Omit<Conversation, 'id'>[] = [
  {
    participants: ['maya'],
    group: false,
    starred: true,
    unread: 0,
    messages: [
      { from: 'maya', at: '2026-06-02T09:10:00Z', body: 'Decomposed Epic-011 into eight Stories. Before I assign them out, I want your read on the kill criteria — a couple feel too soft to ever actually stop us.' },
      { from: OPERATOR_ID, at: '2026-06-02T09:18:00Z', body: 'Agreed on Story 3 especially. Tighten it so "no measurable lift in 2 weeks" is the trigger, not a vibe.' },
      { from: 'maya', at: '2026-06-02T09:24:00Z', body: 'Good. I\'ll have Nadia write the criterion and I\'ll hold the hypothesis. Boundary as language — the org moves faster once it\'s written down.' },
    ],
  },
  {
    participants: ['dario'],
    group: false,
    starred: false,
    unread: 2,
    messages: [
      { from: 'dario', at: '2026-06-01T01:25:00Z', body: 'Heads up: Yuki\'s discord-heartbeat and my feed-post are both on cron(* * ? * *) to verify the wire path. The agent.json note says revert after one clean fire.' },
      { from: 'dario', at: '2026-06-01T01:27:00Z', body: 'The fire path is proven now — I\'ll open the revert PR. Also drafting an L2 lint so an every-minute cron with a stale TEMPORARY note fails CI.' },
    ],
  },
  {
    participants: ['nadia'],
    group: false,
    starred: false,
    unread: 0,
    messages: [
      { from: OPERATOR_ID, at: '2026-05-30T14:02:00Z', body: 'The kill criterion you wrote for Story 5 is the clearest one in the Epic. Can you do a pass on the older Stories too?' },
      { from: 'nadia', at: '2026-05-30T14:20:00Z', body: 'On it. A Story without a kill criterion is just a wish — I\'ll backfill the four that are missing one.' },
    ],
  },
  {
    participants: ['elena', 'aoi', 'kai', 'yuki'],
    group: true,
    groupLabel: 'Elena + reports',
    starred: false,
    unread: 1,
    messages: [
      { from: 'elena', at: '2026-05-29T10:00:00Z', body: 'PR 171 review thread is getting long. Let\'s settle the secrets-by-basename question here instead of in GitHub comments.' },
      { from: 'aoi', at: '2026-05-29T10:06:00Z', body: 'One routine per skill broke the symmetry with the single Lambda runner. Looking up secrets by routine_spec basename fixes it — one CCR covers everything.' },
      { from: 'kai', at: '2026-05-29T10:09:00Z', body: 'Agree. I\'ll update the infra doc so the next person doesn\'t re-derive this.' },
    ],
  },
  {
    participants: ['priya'],
    group: false,
    starred: false,
    unread: 0,
    messages: [
      { from: 'priya', at: '2026-05-28T16:40:00Z', body: 'PR 123\'s Epic body is quietly re-shaping Epic-002\'s IA. That\'s "two docs deciding the same thing" — read later you can\'t trace which decided what.' },
      { from: OPERATOR_ID, at: '2026-05-28T16:52:00Z', body: 'Good catch. One layer per change, docs included. Want to take the cleanup?' },
      { from: 'priya', at: '2026-05-28T16:55:00Z', body: 'Yes. I\'ll fold the IA back into Epic-002 and leave PR 123 to its actual scope.' },
    ],
  },
  {
    participants: ['vikram'],
    group: false,
    starred: false,
    unread: 0,
    messages: [
      { from: 'vikram', at: '2026-05-27T08:15:00Z', body: 'wf-agent-runner is green across all 17 bindings after the dispatch refactor. Cold-start is down to ~900ms.' },
      { from: OPERATOR_ID, at: '2026-05-27T08:31:00Z', body: 'Nice. Ship it.' },
    ],
  },
  {
    participants: ['sora'],
    group: false,
    starred: false,
    unread: 0,
    messages: [
      { from: 'sora', at: '2026-05-26T12:00:00Z', body: 'Pulled the week\'s feed posts into a digest. The "friction → L2 lint" pattern showed up four times — might be worth a standing convention.' },
    ],
  },
];

/**
 * Builds the deterministic mock thread list, dropping any template whose
 * talent isn't in the current roster. Sorted newest-first by last message.
 */
export function buildMockThreads(roster: WorkforceAgent[]): Conversation[] {
  const known = new Set(roster.map((a) => a.slug));
  return TEMPLATES.filter((t) =>
    // Keep a thread only if at least its primary participant exists. Group
    // threads also need their message senders to resolve to known agents.
    t.participants.every((p) => known.has(p)) &&
    t.messages.every((m) => m.from === OPERATOR_ID || known.has(m.from)),
  )
    .map((t, i) => ({ ...t, id: `mock-${i}-${t.participants.join('-')}` }))
    .sort((a, b) => Date.parse(lastAt(b)) - Date.parse(lastAt(a)));
}

export function lastMessage(c: Conversation): ChatMessage {
  return c.messages[c.messages.length - 1];
}

export function lastAt(c: Conversation): string {
  return lastMessage(c).at;
}

// ----- Live messaging store (Epic-013 Story 1, issue 248) -----
//
// When the live agents-api is configured (authenticated workforce origin),
// /messaging reads from the real THREAD store; on the public gh-pages
// mirror the API base is empty and the page keeps the deterministic mock
// above (same dual posture as workforce-mock-stats.json). The wire shapes
// map straight back onto Conversation / ChatMessage — the kill criterion
// for Story 1 is that this mapping stays cosmetic.

interface ThreadSummaryDto {
  thread_id: string;
  participants: string[];
  group: boolean;
  group_label?: string;
  starred: boolean;
  unread: number;
  last_message: { from: string; at: string; preview: string };
}

interface ThreadDetailDto {
  thread_id: string;
  participants: string[];
  group: boolean;
  group_label?: string;
  starred: boolean;
  created_by: string;
  created_at: string;
  messages: Array<{ message_id: string; from: string; at: string; body: string }>;
  /** Cursor to the next older message page (Epic-024); absent at the start
   *  of the thread. */
  older_cursor?: string;
}

function summaryToConversation(t: ThreadSummaryDto): Conversation {
  return {
    id: t.thread_id,
    participants: t.participants,
    group: t.group,
    groupLabel: t.group_label,
    starred: t.starred,
    unread: t.unread,
    // The inbox summary carries only the last message; the full transcript
    // is hydrated by fetchThreadDetail when the thread is opened.
    messages: [{ from: t.last_message.from, at: t.last_message.at, body: t.last_message.preview }],
  };
}

function detailToConversation(d: ThreadDetailDto): Conversation {
  return {
    id: d.thread_id,
    participants: d.participants,
    group: d.group,
    groupLabel: d.group_label,
    starred: d.starred,
    unread: 0,
    messages: d.messages.map((m) => ({ id: m.message_id, from: m.from, at: m.at, body: m.body })),
    olderCursor: d.older_cursor,
  };
}

/** Fetch the operator inbox (thread summaries), newest-first. Returns []
 *  when the live API is not configured. */
export async function fetchThreadSummaries(): Promise<Conversation[]> {
  if (!apiConfigured()) return [];
  const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/threads`);
  if (!res.ok) throw new Error(`agents-api ${res.status}`);
  const data = (await res.json()) as { threads: ThreadSummaryDto[] };
  return data.threads.map(summaryToConversation);
}

/** Fetch one page of a thread's transcript — the NEWEST page by default,
 *  or the older page at `cursor` (Epic-024 reverse history walk). Returns
 *  undefined on 404 / when the live API is not configured. */
export async function fetchThreadDetail(
  id: string,
  opts: { cursor?: string; pageSize?: number } = {},
): Promise<Conversation | undefined> {
  if (!apiConfigured()) return undefined;
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.pageSize !== undefined) params.set('page_size', String(opts.pageSize));
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/threads/${encodeURIComponent(id)}${qs}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`agents-api ${res.status}`);
  const d = (await res.json()) as ThreadDetailDto;
  return detailToConversation(d);
}

/** Stable identity for de-duplicating merged pages: the server ULID when
 *  present, else the (from, at, body) triple (mock / summary messages). */
function messageKey(m: ChatMessage): string {
  return m.id ?? `${m.from}|${m.at}|${m.body}`;
}

/**
 * Union two loaded slices of one thread's history into a single
 * chronological list, dropping duplicates (pages overlap when a poll
 * re-fetches the newest page after older pages were prepended). Pure so
 * the page can derive cache updates and the test can pin the ordering.
 */
export function mergeMessages(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const merged: ChatMessage[] = [];
  for (const m of [...a, ...b]) {
    const k = messageKey(m);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(m);
  }
  return merged.sort((x, y) => {
    const d = Date.parse(x.at) - Date.parse(y.at);
    if (d !== 0) return d;
    // ULIDs are time-ordered — tie-break same-second messages by id.
    const xi = x.id ?? '';
    const yi = y.id ?? '';
    return xi < yi ? -1 : xi > yi ? 1 : 0;
  });
}

// ----- Operator write path (Epic-013 Story 2b) -----
//
// The four POST routes are AWS_IAM-gated (PR 266) — identical posture to
// the credentials-api writes — so every write goes through `signedFetch`
// (lib/sigv4.ts), which SigV4-signs with the operator's temporary
// Identity-Pool credentials. The author is always the operator at the
// gateway; the SPA never sends a `from`. Talent replies arrive via the
// Story 3 runner, not from here.
//
// Reads stay on plain `fetch` (public CORS gate); only writes need signing.

/** True when the operator write path is usable: live API base configured
 *  AND the SigV4 broker has its Identity-Pool config. Mirrors the
 *  credentials UI's enablement gate so compose is hidden on the mock. */
export function messagingWriteEnabled(): boolean {
  return apiConfigured() && SIGV4_IS_CONFIGURED;
}

/** Best-effort error-body reader — surfaces the handler's `{error,detail}`
 *  text for the operator banner without making JSON parsing its own
 *  failure mode (mirrors lib/credentials.ts). */
async function readErrorBody(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string; detail?: string };
    return [data.error, data.detail].filter(Boolean).join(' · ');
  } catch {
    return '';
  }
}

async function postSigned(path: string, body?: unknown): Promise<Response> {
  assertSigv4Configured();
  const init: RequestInit =
    body === undefined
      ? { method: 'POST' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await signedFetch(`${WORKFORCE_AGENTS_API_BASE}${path}`, init);
  if (!res.ok) {
    const detail = await readErrorBody(res);
    throw new Error(`agents-api ${res.status}${detail ? ` · ${detail}` : ''}`);
  }
  return res;
}

/** Start a thread with one or more talents, seeded with `body` (Epic-024:
 *  >1 slug creates a group thread — the backend derives `group` from the
 *  participant count). Returns the new thread id so the caller can select
 *  it. */
export async function createThread(
  talentSlugs: string[],
  body: string,
  groupLabel?: string,
): Promise<string> {
  const res = await postSigned('/threads', {
    participants: talentSlugs,
    body,
    ...(groupLabel !== undefined ? { group_label: groupLabel } : {}),
  });
  const data = (await res.json()) as { thread_id: string };
  return data.thread_id;
}

/** Append an operator message to an existing thread. */
export async function sendMessage(threadId: string, body: string): Promise<void> {
  await postSigned(`/threads/${encodeURIComponent(threadId)}/messages`, { body });
}

/** Clear the operator's unread count on a thread. */
export async function markThreadRead(threadId: string): Promise<void> {
  await postSigned(`/threads/${encodeURIComponent(threadId)}/read`);
}

/** Set (not toggle) the operator star on a thread. */
export async function setThreadStar(threadId: string, starred: boolean): Promise<void> {
  await postSigned(`/threads/${encodeURIComponent(threadId)}/star`, { starred });
}

/** Whether to show a "drafting…" affordance on an open 1:1 thread: the
 *  operator is waiting on the talent's reply (armed at send time, expiring at
 *  `until`) and it hasn't landed yet (the last message is still the
 *  operator's). Pure so the page can derive it and the test can pin it.
 *  Group threads never show it (Story 3b is 1:1-only for the indicator). */
export function isAwaitingReply(
  conv: Conversation | undefined,
  until: number | undefined,
  now: number,
): boolean {
  if (!conv || conv.group || !until || until <= now) return false;
  const last = conv.messages[conv.messages.length - 1];
  return !!last && last.from === OPERATOR_ID;
}
