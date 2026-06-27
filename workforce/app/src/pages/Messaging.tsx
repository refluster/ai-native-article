// /messaging — talent-to-talent communication, reskinned to mirror
// LinkedIn's Messaging layout: a conversation list on the left, the open
// thread in the center, and a "Page inboxes" + disclosure rail on the
// right. Threads are deterministic mock data (see lib/messages.ts) until
// the live messaging store lands.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Sigil from '../components/Sigil';
import { loadWorkforceManifest, fullName, apiConfigured } from '../lib/agents';
import {
  buildMockThreads,
  fetchThreadSummaries,
  fetchThreadDetail,
  createThread,
  sendMessage,
  markThreadRead,
  setThreadStar,
  messagingWriteEnabled,
  isAwaitingReply,
  lastMessage,
  lastAt,
  OPERATOR_ID,
  type Conversation,
  type ChatMessage,
} from '../lib/messages';
import { SITE_DISPLAY_NAME, SITE_TAGLINE, OPERATOR } from '../config/site';
import type { WorkforceAgent } from '../types/agent';

// Functional filters bind to real PART# state (unread count / star). The
// remaining LinkedIn-flavour chips (Focused / Connections / InMail) have no
// backing data at single-operator scale, so they stay decorative.
type MsgFilter = 'all' | 'unread' | 'starred';
const INERT_PILLS = ['Focused', 'Connections', 'InMail'];

function fmtListDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtMsgTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(
    'en-US',
    { hour: 'numeric', minute: '2-digit' },
  )}`;
}

// Monogram avatar for the human operator (distinct from agent Sigils).
function OperatorAvatar({ size = 40 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-wf-primary text-wf-on-primary font-headline font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
      aria-hidden
    >
      {OPERATOR.initials}
    </span>
  );
}

// Up to two stacked avatars for a thread (group threads stack the first
// two participants the way LinkedIn does).
function ThreadAvatar({ conv }: { conv: Conversation }) {
  const slugs = conv.participants.slice(0, 2);
  if (conv.group && slugs.length > 1) {
    return (
      <span className="relative w-12 h-12 shrink-0" aria-hidden>
        <span className="absolute top-0 left-0"><Sigil slug={slugs[0]} size={34} /></span>
        <span className="absolute bottom-0 right-0 ring-2 ring-wf-surface-container-lo rounded-full">
          <Sigil slug={slugs[1]} size={28} />
        </span>
      </span>
    );
  }
  return <Sigil slug={slugs[0]} size={48} />;
}

function convTitle(conv: Conversation, roster: Map<string, WorkforceAgent>): string {
  if (conv.group) {
    const names = conv.participants
      .map((s) => roster.get(s)?.first_name)
      .filter(Boolean) as string[];
    const head = names.slice(0, 2).join(', ');
    const extra = names.length > 2 ? `, +${names.length - 2}` : '';
    return `${head}${extra}`;
  }
  const a = roster.get(conv.participants[0]);
  return a ? fullName(a) : conv.participants[0];
}

function senderName(slug: string, roster: Map<string, WorkforceAgent>): string {
  if (slug === OPERATOR_ID) return OPERATOR.name;
  const a = roster.get(slug);
  return a ? fullName(a) : slug;
}

// Live when the agents-api base is configured (authenticated workforce
// origin); mock on the public gh-pages mirror. Resolved once at module
// scope — the build-time env var doesn't change within a session.
const LIVE = apiConfigured();
// Compose + send + read + star require the SigV4 broker (operator login),
// not just a configured read base. Mock origin → false → placeholder UI.
const CAN_WRITE = messagingWriteEnabled();

// Story 3b receive-side timings. The reply Lambda answers in seconds; we poll
// the open thread every POLL_MS only while an "awaiting reply" window is
// active (REPLY_WAIT_MS after a send), so there's no steady-state polling.
const POLL_MS = 4000;
const REPLY_WAIT_MS = 75_000;

export default function Messaging() {
  const [roster, setRoster] = useState<WorkforceAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MsgFilter>('all');
  // Live inbox summaries (null until loaded); detailCache holds the full
  // transcript for threads the operator has opened.
  const [liveThreads, setLiveThreads] = useState<Conversation[] | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, Conversation>>({});
  // Compose-to-new state: when true the centre pane shows the recipient
  // picker + first-message composer instead of an open thread.
  const [composing, setComposing] = useState(false);
  // Mobile is single-pane: the list and the thread/compose pane can't sit
  // side-by-side on a phone. This flag drives which one is on screen below
  // the `md` breakpoint (false = list, true = thread/compose). It's inert on
  // md+ where both panes render together via the responsive classes.
  const [showThreadMobile, setShowThreadMobile] = useState(false);
  // Real-time receive (Story 3b): after the operator sends, we arm a short
  // "awaiting reply" window per thread (until = expiry ms) and poll the open
  // thread so the talent's async reply (wf-messaging-reply) surfaces without a
  // manual refresh. See ADR-0006 on why this is bounded polling, not SSE/WS.
  const [pendingReplyUntil, setPendingReplyUntil] = useState<Record<string, number>>({});
  // Per-thread last-seen message count — the poll's change detector. A ref so
  // updating it never itself triggers a render.
  const seenLenRef = useRef<Record<string, number>>({});

  useEffect(() => {
    document.title = `${SITE_DISPLAY_NAME} — Messaging`;
    loadWorkforceManifest()
      .then((m) => setRoster(m.agents))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!LIVE) return;
    fetchThreadSummaries()
      .then(setLiveThreads)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const rosterMap = useMemo(() => {
    const map = new Map<string, WorkforceAgent>();
    for (const a of roster) map.set(a.slug, a);
    return map;
  }, [roster]);

  const threads = useMemo(
    () => (LIVE ? (liveThreads ?? []) : buildMockThreads(roster)),
    [liveThreads, roster],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((c) => {
      if (filter === 'unread' && c.unread === 0) return false;
      if (filter === 'starred' && !c.starred) return false;
      if (!q) return true;
      if (convTitle(c, rosterMap).toLowerCase().includes(q)) return true;
      return c.messages.some((m) => m.body.toLowerCase().includes(q));
    });
  }, [threads, query, filter, rosterMap]);

  // Default-select the newest thread once data is in (unless composing).
  useEffect(() => {
    if (!composing && selectedId === null && threads.length > 0) setSelectedId(threads[0].id);
  }, [threads, selectedId, composing]);

  // Lazily hydrate the full transcript for the opened thread (live only —
  // the mock already carries every message inline).
  useEffect(() => {
    if (!LIVE || !selectedId || detailCache[selectedId]) return;
    fetchThreadDetail(selectedId)
      .then((conv) => {
        if (conv) {
          setDetailCache((m) => ({ ...m, [conv.id]: conv }));
          seenLenRef.current[conv.id] = conv.messages.length;
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // detailCache intentionally omitted: the guard above prevents refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Poll the open thread while an awaiting-reply window is active, so the
  // talent's async reply lands without a refresh. Bounded: runs only between a
  // send and `until`, pauses when the tab is hidden, and stops the moment a
  // non-operator message arrives. Single-operator scale (C-3) → trivial load.
  const awaitingUntil = selectedId ? pendingReplyUntil[selectedId] : undefined;
  useEffect(() => {
    if (!LIVE || !selectedId || !awaitingUntil || awaitingUntil <= Date.now()) return;
    const tid = selectedId;
    let cancelled = false;
    const poll = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      let fresh: Conversation | undefined;
      try {
        fresh = await fetchThreadDetail(tid);
      } catch {
        return; // transient; next tick retries
      }
      if (cancelled || !fresh) return;
      const seen = seenLenRef.current[tid] ?? 0;
      if (fresh.messages.length <= seen) return; // nothing new yet
      seenLenRef.current[tid] = fresh.messages.length;
      const conv = fresh;
      setDetailCache((m) => ({ ...m, [tid]: conv }));
      refreshSummaries();
      const last = conv.messages[conv.messages.length - 1];
      if (last && last.from !== OPERATOR_ID) {
        // The reply landed — disarm (stops this poll, hides "drafting…").
        setPendingReplyUntil((p) => {
          const { [tid]: _done, ...rest } = p;
          return rest;
        });
      }
    };
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, awaitingUntil]);

  // Clear the operator's unread the first time a thread with a non-zero
  // badge is opened. Optimistically zero the list badge, then POST /read.
  useEffect(() => {
    if (!CAN_WRITE || !selectedId) return;
    const summary = (liveThreads ?? []).find((c) => c.id === selectedId);
    if (!summary || summary.unread === 0) return;
    setLiveThreads((prev) =>
      (prev ?? []).map((c) => (c.id === selectedId ? { ...c, unread: 0 } : c)),
    );
    markThreadRead(selectedId).catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
    // liveThreads intentionally omitted — the unread!==0 guard is one-shot
    // per open and reading it here would re-fire on the optimistic update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Re-pull the inbox summaries after a write so previews / ordering / the
  // new thread land without a page reload.
  function refreshSummaries(): void {
    if (!LIVE) return;
    fetchThreadSummaries()
      .then(setLiveThreads)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  function openThread(id: string): void {
    setComposing(false);
    setSelectedId(id);
    setShowThreadMobile(true); // slide the thread in over the list on mobile
  }

  // Mobile back: slide the list back over the open thread / composer.
  function backToList(): void {
    setShowThreadMobile(false);
  }

  // Arm an awaiting-reply window for a thread the operator just posted to. The
  // poll effect picks it up; a timeout disarms it if no reply lands in time
  // (drafting just stops — no error; the reply may still arrive on next open).
  function armPendingReply(threadId: string): void {
    if (!LIVE) return;
    const until = Date.now() + REPLY_WAIT_MS;
    setPendingReplyUntil((p) => ({ ...p, [threadId]: until }));
    window.setTimeout(() => {
      setPendingReplyUntil((p) => {
        if (p[threadId] !== until) return p; // re-armed by a newer send
        const { [threadId]: _expired, ...rest } = p;
        return rest;
      });
    }, REPLY_WAIT_MS + 500);
  }

  // Compose-to-new: create a 1:1 thread, then select it and refresh.
  async function handleCreateThread(talentSlug: string, body: string): Promise<void> {
    const threadId = await createThread(talentSlug, body);
    setComposing(false);
    setSelectedId(threadId);
    refreshSummaries();
    armPendingReply(threadId);
  }

  // Append to the open thread, then re-hydrate its transcript + the list.
  async function handleSend(threadId: string, body: string): Promise<void> {
    await sendMessage(threadId, body);
    const fresh = await fetchThreadDetail(threadId);
    if (fresh) {
      setDetailCache((m) => ({ ...m, [threadId]: fresh }));
      seenLenRef.current[threadId] = fresh.messages.length;
    }
    refreshSummaries();
    armPendingReply(threadId);
  }

  async function handleToggleStar(threadId: string, starred: boolean): Promise<void> {
    setLiveThreads((prev) =>
      (prev ?? []).map((c) => (c.id === threadId ? { ...c, starred } : c)),
    );
    setDetailCache((m) =>
      m[threadId] ? { ...m, [threadId]: { ...m[threadId], starred } } : m,
    );
    try {
      await setThreadStar(threadId, starred);
    } catch (err) {
      refreshSummaries(); // revert optimistic flip from the source of truth
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const selected =
    (selectedId ? detailCache[selectedId] : undefined) ??
    threads.find((c) => c.id === selectedId) ??
    null;

  if (error) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-sm text-wf-tertiary">Could not load messaging: {error}</div>
      </WorkforceLayout>
    );
  }

  return (
    <WorkforceLayout contained={false}>
      <div className="max-w-[1128px] mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 sm:gap-6 items-start">
          {/* MAIN: list + thread. Two panes side-by-side on md+; a single
              swappable pane (flex column) on mobile, toggled by
              showThreadMobile. */}
          <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md overflow-hidden flex flex-col md:grid md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)] h-[calc(100vh-9rem)] min-h-[480px]">
            {/* LEFT: conversation list — full pane on mobile when no thread is
                open, always shown on md+. */}
            <div className={`${showThreadMobile ? 'hidden' : 'flex'} md:flex flex-1 md:flex-none flex-col md:border-r border-wf-outline-variant min-h-0`}>
              <div className="px-3 py-2.5 flex items-center justify-between gap-2 border-b border-wf-outline-variant">
                <div className="font-headline font-bold text-wf-on-surface">Messaging</div>
                <button
                  type="button"
                  title={CAN_WRITE ? 'New message' : 'Composing is disabled in this placeholder.'}
                  aria-label="New message"
                  disabled={!CAN_WRITE}
                  onClick={() => {
                    if (!CAN_WRITE) return;
                    setComposing(true);
                    setSelectedId(null);
                    setShowThreadMobile(true); // reveal the composer on mobile
                  }}
                  className={`w-8 h-8 inline-flex items-center justify-center rounded-full ${
                    composing ? 'bg-wf-surface-container text-wf-on-surface' : 'text-wf-on-surface-variant'
                  } ${CAN_WRITE ? 'hover:bg-wf-surface-container hover:text-wf-on-surface' : 'opacity-40 cursor-not-allowed'}`}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M4 20l4-1L19 8a2 2 0 0 0-3-3L5 16l-1 4Z" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              <div className="px-3 py-2 border-b border-wf-outline-variant">
                <div className="flex items-center gap-2 bg-wf-surface-container rounded-wf-sm px-2.5 h-8">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8} className="text-wf-on-surface-variant shrink-0">
                    <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" strokeLinecap="round" />
                  </svg>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search messages"
                    className="bg-transparent text-sm text-wf-on-surface placeholder:text-wf-on-surface-variant w-full focus:outline-none"
                  />
                </div>
                <div className="mt-2 flex items-center gap-1.5 overflow-x-auto">
                  <span className="font-wfmono text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 rounded-full bg-wf-running text-wf-on-primary whitespace-nowrap">
                    Focused ▾
                  </span>
                  {(['unread', 'starred'] as const).map((f) => {
                    const on = filter === f;
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFilter(on ? 'all' : f)}
                        aria-pressed={on}
                        className={`font-wfmono text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 rounded-full whitespace-nowrap border ${
                          on
                            ? 'bg-wf-secondary text-wf-on-primary border-wf-secondary'
                            : 'border-wf-outline-variant text-wf-on-surface-variant hover:bg-wf-surface-container'
                        }`}
                      >
                        {f}
                      </button>
                    );
                  })}
                  {INERT_PILLS.map((p) => (
                    <span
                      key={p}
                      className="font-wfmono text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 rounded-full border border-wf-outline-variant text-wf-on-surface-variant whitespace-nowrap"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>

              <ul className="flex-1 overflow-y-auto min-h-0">
                {visible.length === 0 ? (
                  <li className="px-4 py-6 font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                    No conversations match.
                  </li>
                ) : (
                  visible.map((c) => {
                    const last = lastMessage(c);
                    const active = c.id === selectedId;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => openThread(c.id)}
                          className={`w-full text-left flex gap-3 px-3 py-3 border-l-2 transition-colors ${
                            active && !composing
                              ? 'border-wf-running bg-wf-surface-container'
                              : 'border-transparent hover:bg-wf-surface-container'
                          }`}
                        >
                          <ThreadAvatar conv={c} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className={`truncate ${c.unread > 0 ? 'font-bold text-wf-on-surface' : 'font-semibold text-wf-on-surface'}`}>
                                {convTitle(c, rosterMap)}
                              </span>
                              <span className="font-wfmono text-[10px] text-wf-on-surface-variant shrink-0">
                                {fmtListDate(lastAt(c))}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <p className={`text-xs truncate ${c.unread > 0 ? 'text-wf-on-surface' : 'text-wf-on-surface-variant'}`}>
                                <span className="text-wf-on-surface-variant">
                                  {last.from === OPERATOR_ID ? 'You: ' : `${senderName(last.from, rosterMap).split(' ')[0]}: `}
                                </span>
                                {last.body}
                              </p>
                              {c.unread > 0 && (
                                <span className="ml-auto shrink-0 min-w-[16px] h-4 px-1 rounded-full bg-wf-primary text-wf-on-primary text-[9px] font-bold flex items-center justify-center">
                                  {c.unread}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>

            {/* RIGHT: compose-to-new, open thread, or empty state — full pane
                on mobile when a thread/composer is open, always shown on md+. */}
            <div className={`${showThreadMobile ? 'flex' : 'hidden'} md:flex flex-1 md:flex-none flex-col min-h-0`}>
              {composing ? (
                <Compose
                  roster={roster}
                  rosterMap={rosterMap}
                  existing={threads}
                  onCancel={() => {
                    setComposing(false);
                    setShowThreadMobile(false); // drop back to the list on mobile
                  }}
                  onBack={backToList}
                  onCreate={handleCreateThread}
                  onOpenExisting={openThread}
                />
              ) : selected ? (
                <Thread
                  conv={selected}
                  roster={rosterMap}
                  canWrite={CAN_WRITE}
                  onBack={backToList}
                  onSend={handleSend}
                  onToggleStar={handleToggleStar}
                  drafting={isAwaitingReply(selected, awaitingUntil, Date.now())}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                  Select a conversation
                </div>
              )}
            </div>
          </div>

          {/* RIGHT RAIL: page inboxes + disclosure */}
          <aside className="space-y-3 lg:sticky lg:top-[72px] self-start">
            <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4">
              <div className="font-headline font-bold text-sm text-wf-on-surface mb-3">Page inboxes</div>
              <Link to="/performance" className="flex items-center gap-2.5 group">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-wf-sm bg-wf-secondary text-wf-on-primary font-headline font-black text-sm shrink-0">
                  S
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-wf-on-surface truncate group-hover:text-wf-primary">
                    {SITE_DISPLAY_NAME}
                  </div>
                  <div className="text-[11px] text-wf-on-surface-variant truncate">{SITE_TAGLINE}</div>
                </div>
              </Link>
            </div>

            <div className="border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-3">
              <div className="font-wfmono text-[9px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1">
                {CAN_WRITE ? 'Disclosure · live' : LIVE ? 'Disclosure · live read-only' : 'Disclosure · placeholder data'}
              </div>
              <p className="text-[11px] text-wf-on-surface-variant leading-relaxed">
                {CAN_WRITE
                  ? "Threads are live and you can start threads and send messages. Talent replies arrive asynchronously on the addressed agent's next run (Epic-013 Story 3)."
                  : LIVE
                    ? "Threads are live from the messaging store, read-only here — composing needs the operator login (SigV4) the build didn't supply."
                    : "Threads are illustrative mock data — the live talent-to-talent messaging store isn't wired yet. Voice and IA match the v1 target. Composing is disabled."}
              </p>
            </div>

            <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4">
              <div className="font-headline font-bold text-sm text-wf-on-surface mb-2">Talk to the crew</div>
              <p className="text-xs text-wf-on-surface-variant leading-relaxed mb-3">
                Every thread maps to an edge in the org graph — who reports to whom, who works
                laterally. Browse the roster to see the network behind these conversations.
              </p>
              <Link to="/agents" className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary hover:underline">
                My Network →
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </WorkforceLayout>
  );
}

// ── Open thread pane ───────────────────────────────────────────────────
function Thread({
  conv,
  roster,
  canWrite,
  onBack,
  onSend,
  onToggleStar,
  drafting,
}: {
  conv: Conversation;
  roster: Map<string, WorkforceAgent>;
  canWrite: boolean;
  onBack: () => void;
  onSend: (threadId: string, body: string) => Promise<void>;
  onToggleStar: (threadId: string, starred: boolean) => Promise<void>;
  drafting: boolean;
}) {
  const headAgent = roster.get(conv.participants[0]);
  const title = convTitle(conv, roster);
  const subtitle = conv.group
    ? `${conv.participants.length} talents · ${conv.groupLabel ?? 'group'}`
    : headAgent
      ? `${headAgent.role} · ${headAgent.residence}`
      : '';

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Reset the composer when switching threads.
  useEffect(() => {
    setDraft('');
    setSendError(null);
  }, [conv.id]);

  const canSubmit = canWrite && draft.trim().length > 0 && !sending;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend(conv.id, draft.trim());
      setDraft('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="px-4 py-2.5 border-b border-wf-outline-variant flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="md:hidden -ml-1 mr-0.5 w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-full text-wf-on-surface-variant hover:bg-wf-surface-container hover:text-wf-on-surface"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          {conv.group ? (
            <div className="font-bold text-wf-on-surface truncate">{title}</div>
          ) : (
            <Link to={`/agents/${conv.participants[0]}`} className="font-bold text-wf-on-surface truncate hover:text-wf-primary block">
              {title}
            </Link>
          )}
          <div className="text-[11px] text-wf-on-surface-variant truncate">{subtitle}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0 text-wf-on-surface-variant">
          {canWrite ? (
            <button
              type="button"
              title={conv.starred ? 'Unstar' : 'Star'}
              aria-pressed={conv.starred}
              onClick={() => onToggleStar(conv.id, !conv.starred)}
              className={`w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-wf-surface-container ${
                conv.starred ? 'text-wf-tertiary' : ''
              }`}
            >
              {conv.starred ? '★' : '☆'}
            </button>
          ) : (
            conv.starred && <span title="Starred" className="text-wf-tertiary">★</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-4">
        {conv.messages.map((m, i) => (
          <MessageRow key={i} msg={m} roster={roster} />
        ))}
        {drafting && (
          <div className="flex items-center gap-2 pl-[52px] text-[11px] text-wf-on-surface-variant font-wfmono">
            <span>{title.split(' ')[0]} is drafting</span>
            <span className="inline-flex gap-0.5" aria-hidden="true">
              <span className="animate-bounce [animation-delay:-0.3s]">·</span>
              <span className="animate-bounce [animation-delay:-0.15s]">·</span>
              <span className="animate-bounce">·</span>
            </span>
          </div>
        )}
      </div>

      <div className="px-3 py-3 border-t border-wf-outline-variant">
        {canWrite ? (
          <>
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter inserts a newline (LinkedIn parity).
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                rows={1}
                placeholder="Write a message…"
                className="flex-1 resize-none max-h-32 px-3 py-2 rounded-wf-sm border border-wf-outline bg-wf-surface-container-lo text-sm text-wf-on-surface placeholder:text-wf-on-surface-variant focus:outline-none focus:border-wf-primary"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
                className={`h-9 px-4 rounded-wf-sm font-wfmono text-[11px] uppercase tracking-[0.12em] ${
                  canSubmit
                    ? 'bg-wf-primary text-wf-on-primary hover:opacity-90'
                    : 'bg-wf-surface-container text-wf-on-surface-variant cursor-not-allowed'
                }`}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
            {sendError && (
              <div className="mt-1.5 font-wfmono text-[10px] text-wf-tertiary">Could not send: {sendError}</div>
            )}
          </>
        ) : (
          <div
            className="h-10 px-3 flex items-center rounded-wf-sm border border-wf-outline text-sm text-wf-on-surface-variant select-none cursor-not-allowed"
            title="Composing is disabled in this placeholder."
          >
            Write a message…
          </div>
        )}
      </div>
    </>
  );
}

// ── Compose-to-new pane: pick a talent (single, 1:1) + first message ─────
function Compose({
  roster,
  rosterMap,
  existing,
  onCancel,
  onBack,
  onCreate,
  onOpenExisting,
}: {
  roster: WorkforceAgent[];
  rosterMap: Map<string, WorkforceAgent>;
  existing: Conversation[];
  onCancel: () => void;
  onBack: () => void;
  onCreate: (talentSlug: string, body: string) => Promise<void>;
  onOpenExisting: (id: string) => void;
}) {
  const [pickQuery, setPickQuery] = useState('');
  const [recipient, setRecipient] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    return roster
      .filter((a) => !q || fullName(a).toLowerCase().includes(q) || a.slug.includes(q) || a.role.toLowerCase().includes(q))
      .slice(0, 40);
  }, [roster, pickQuery]);

  // If the operator already has a 1:1 thread with this talent, offer to
  // open it rather than silently creating a duplicate.
  const existingThread = useMemo(
    () => (recipient ? existing.find((c) => !c.group && c.participants[0] === recipient) : undefined),
    [recipient, existing],
  );

  const canSubmit = !!recipient && draft.trim().length > 0 && !busy;

  async function submit(): Promise<void> {
    if (!canSubmit || !recipient) return;
    setBusy(true);
    setCreateError(null);
    try {
      await onCreate(recipient, draft.trim());
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="px-4 py-2.5 border-b border-wf-outline-variant flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to conversations"
            className="md:hidden -ml-1 w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-full text-wf-on-surface-variant hover:bg-wf-surface-container hover:text-wf-on-surface"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="font-bold text-wf-on-surface">New message</div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant hover:text-wf-on-surface"
        >
          Cancel
        </button>
      </div>

      {/* Recipient row */}
      <div className="px-4 py-2.5 border-b border-wf-outline-variant">
        {recipient ? (
          <div className="flex items-center gap-2">
            <span className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant">To:</span>
            <span className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-wf-surface-container">
              <Sigil slug={recipient} size={20} />
              <span className="text-sm text-wf-on-surface">{rosterMap.get(recipient) ? fullName(rosterMap.get(recipient)!) : recipient}</span>
              <button type="button" onClick={() => setRecipient(null)} className="text-wf-on-surface-variant hover:text-wf-on-surface" aria-label="Clear recipient">×</button>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-wf-surface-container rounded-wf-sm px-2.5 h-8">
            <span className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant">To:</span>
            <input
              type="search"
              autoFocus
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              placeholder="Search talent…"
              className="bg-transparent text-sm text-wf-on-surface placeholder:text-wf-on-surface-variant w-full focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Either the candidate list (no recipient yet) or the composer */}
      {!recipient ? (
        <ul className="flex-1 overflow-y-auto min-h-0">
          {candidates.length === 0 ? (
            <li className="px-4 py-6 font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
              No talent matches.
            </li>
          ) : (
            candidates.map((a) => (
              <li key={a.slug}>
                <button
                  type="button"
                  onClick={() => { setRecipient(a.slug); setPickQuery(''); }}
                  className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-wf-surface-container"
                >
                  <Sigil slug={a.slug} size={36} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-wf-on-surface truncate">{fullName(a)}</div>
                    <div className="text-[11px] text-wf-on-surface-variant truncate">{a.role}</div>
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
            {existingThread && (
              <div className="mb-3 text-[11px] text-wf-on-surface-variant leading-relaxed">
                You already have a thread with this talent.{' '}
                <button
                  type="button"
                  onClick={() => onOpenExisting(existingThread.id)}
                  className="font-wfmono uppercase tracking-[0.12em] text-wf-primary hover:underline"
                >
                  Open it →
                </button>
              </div>
            )}
          </div>
          <div className="px-3 py-3 border-t border-wf-outline-variant">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
                }}
                rows={1}
                autoFocus
                placeholder="Write a message…"
                className="flex-1 resize-none max-h-32 px-3 py-2 rounded-wf-sm border border-wf-outline bg-wf-surface-container-lo text-sm text-wf-on-surface placeholder:text-wf-on-surface-variant focus:outline-none focus:border-wf-primary"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
                className={`h-9 px-4 rounded-wf-sm font-wfmono text-[11px] uppercase tracking-[0.12em] ${
                  canSubmit ? 'bg-wf-primary text-wf-on-primary hover:opacity-90' : 'bg-wf-surface-container text-wf-on-surface-variant cursor-not-allowed'
                }`}
              >
                {busy ? 'Starting…' : 'Send'}
              </button>
            </div>
            {createError && (
              <div className="mt-1.5 font-wfmono text-[10px] text-wf-tertiary">Could not start thread: {createError}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function MessageRow({ msg, roster }: { msg: ChatMessage; roster: Map<string, WorkforceAgent> }) {
  const isOperator = msg.from === OPERATOR_ID;
  const name = senderName(msg.from, roster);
  return (
    <div className="flex gap-3">
      {isOperator ? <OperatorAvatar size={40} /> : <Sigil slug={msg.from} size={40} />}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {isOperator ? (
            <span className="font-semibold text-sm text-wf-on-surface">{name}</span>
          ) : (
            <Link to={`/agents/${msg.from}`} className="font-semibold text-sm text-wf-on-surface hover:text-wf-primary">
              {name}
            </Link>
          )}
          <span className="font-wfmono text-[10px] text-wf-on-surface-variant">{fmtMsgTime(msg.at)}</span>
        </div>
        <p className="mt-0.5 text-sm text-wf-on-surface leading-relaxed whitespace-pre-wrap">{msg.body}</p>
      </div>
    </div>
  );
}
