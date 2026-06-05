// /messaging — talent-to-talent communication, reskinned to mirror
// LinkedIn's Messaging layout: a conversation list on the left, the open
// thread in the center, and a "Page inboxes" + disclosure rail on the
// right. Threads are deterministic mock data (see lib/messages.ts) until
// the live messaging store lands.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Sigil from '../components/Sigil';
import { loadWorkforceManifest, fullName } from '../lib/agents';
import {
  buildMockThreads,
  lastMessage,
  lastAt,
  OPERATOR_ID,
  type Conversation,
  type ChatMessage,
} from '../lib/messages';
import { SITE_DISPLAY_NAME, SITE_TAGLINE, OPERATOR } from '../config/site';
import type { WorkforceAgent } from '../types/agent';

const FILTER_PILLS = ['Jobs', 'Unread', 'Connections', 'InMail', 'Starred'];

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

export default function Messaging() {
  const [roster, setRoster] = useState<WorkforceAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    document.title = `${SITE_DISPLAY_NAME} — Messaging`;
    loadWorkforceManifest()
      .then((m) => setRoster(m.agents))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const rosterMap = useMemo(() => {
    const map = new Map<string, WorkforceAgent>();
    for (const a of roster) map.set(a.slug, a);
    return map;
  }, [roster]);

  const threads = useMemo(() => buildMockThreads(roster), [roster]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((c) => {
      if (convTitle(c, rosterMap).toLowerCase().includes(q)) return true;
      return c.messages.some((m) => m.body.toLowerCase().includes(q));
    });
  }, [threads, query, rosterMap]);

  // Default-select the newest thread once data is in.
  useEffect(() => {
    if (selectedId === null && threads.length > 0) setSelectedId(threads[0].id);
  }, [threads, selectedId]);

  const selected = threads.find((c) => c.id === selectedId) ?? null;

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
          {/* MAIN: list + thread, two-pane inside one bordered card */}
          <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md overflow-hidden grid grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)] h-[calc(100vh-9rem)] min-h-[480px]">
            {/* LEFT: conversation list */}
            <div className="flex flex-col border-b md:border-b-0 md:border-r border-wf-outline-variant min-h-0">
              <div className="px-3 py-2.5 flex items-center justify-between gap-2 border-b border-wf-outline-variant">
                <div className="font-headline font-bold text-wf-on-surface">Messaging</div>
                <button
                  type="button"
                  title="Compose (placeholder)"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-full text-wf-on-surface-variant hover:bg-wf-surface-container hover:text-wf-on-surface"
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
                  {FILTER_PILLS.map((p) => (
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
                          onClick={() => setSelectedId(c.id)}
                          className={`w-full text-left flex gap-3 px-3 py-3 border-l-2 transition-colors ${
                            active
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

            {/* RIGHT: open thread */}
            <div className="hidden md:flex flex-col min-h-0">
              {selected ? (
                <Thread conv={selected} roster={rosterMap} />
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
                Disclosure · placeholder data
              </div>
              <p className="text-[11px] text-wf-on-surface-variant leading-relaxed">
                Threads are illustrative mock data — the live talent-to-talent messaging store isn't
                wired yet. Voice and IA match the v1 target. Composing is disabled.
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
function Thread({ conv, roster }: { conv: Conversation; roster: Map<string, WorkforceAgent> }) {
  const headAgent = roster.get(conv.participants[0]);
  const title = convTitle(conv, roster);
  const subtitle = conv.group
    ? `${conv.participants.length} talents · ${conv.groupLabel ?? 'group'}`
    : headAgent
      ? `${headAgent.role} · ${headAgent.residence}`
      : '';

  return (
    <>
      <div className="px-4 py-2.5 border-b border-wf-outline-variant flex items-start justify-between gap-2">
        <div className="min-w-0">
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
          {conv.starred && <span title="Starred" className="text-wf-tertiary">★</span>}
          <button type="button" title="More (placeholder)" className="w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-wf-surface-container">
            ···
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-4">
        {conv.messages.map((m, i) => (
          <MessageRow key={i} msg={m} roster={roster} />
        ))}
      </div>

      <div className="px-3 py-3 border-t border-wf-outline-variant">
        <div
          className="h-10 px-3 flex items-center rounded-wf-sm border border-wf-outline text-sm text-wf-on-surface-variant select-none cursor-not-allowed"
          title="Composing is disabled in this placeholder."
        >
          Write a message…
        </div>
      </div>
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
