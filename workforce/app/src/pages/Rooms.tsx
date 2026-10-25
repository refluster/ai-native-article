// /rooms — purpose-first deliberation. A Room is opened FOR a question: the
// operator names the question, summons 2–6 members from the crew, picks a
// chair and a number of rounds; the members deliberate in turn and the
// chair writes the conclusion. Unlike /messaging (participant-first: people
// exist, a conversation attaches), the question comes first here and the
// room ends by construction.
//
// This page is the index (newest first) plus the "New room" panel. The room
// itself is pages/Room.tsx. Reads are live-only — the public gh-pages
// mirror has no room store, so it shows an explanatory empty state rather
// than mock rooms; creating needs the operator SigV4 login on top.

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Sigil from '../components/Sigil';
import { LoadingRegion, Skeleton, SkeletonCircle, SkeletonText } from '../components/Skeleton';
import { apiConfigured, fullName, loadWorkforceManifest } from '../lib/agents';
import {
  ROOM_CONTEXT_MAX_CHARS,
  ROOM_DEFAULT_ROUNDS,
  ROOM_MAX_PARTICIPANTS,
  ROOM_MAX_ROUNDS,
  ROOM_MIN_PARTICIPANTS,
  ROOM_QUESTION_MAX_CHARS,
  ROOM_TITLE_MAX_CHARS,
  createRoom,
  fetchRooms,
  questionLanguage,
  roomsWriteEnabled,
  summarizeQuestion,
  type RoomSummary,
} from '../lib/rooms';
import { SITE_DISPLAY_NAME } from '../config/site';
import type { WorkforceAgent } from '../types/agent';

// Resolved once at module scope — the build-time env doesn't change within
// a session (same as Messaging).
const LIVE = apiConfigured();
const CAN_WRITE = roomsWriteEnabled();
/** Rooms per list page (the API caps it at 100). */
const PAGE_SIZE = 50;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The conclusion preview is the head of a Markdown body that opens with a
 *  `## Conclusion` / `## 結論` heading — drop that label (the card already
 *  says Concluded) and the remaining Markdown marks for a plain excerpt. */
function previewText(md: string): string {
  const plain = md
    .replace(/^\s*#+\s*(?:結論|Conclusion)\s*$/im, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[*_`]/g, '');
  return summarizeQuestion(plain, 320);
}

function RoomStatusPill({ status, archived }: { status: RoomSummary['status']; archived?: boolean }) {
  const m = archived
    ? { label: 'Archived', dot: 'bg-wf-archived', text: 'text-wf-archived' }
    : status === 'debating'
      ? { label: 'Deliberating', dot: 'bg-wf-running', text: 'text-wf-running' }
      : { label: 'Concluded', dot: 'bg-wf-secondary', text: 'text-wf-secondary' };
  return (
    <span className={`inline-flex items-center gap-1.5 font-wfmono text-[10px] uppercase tracking-[0.14em] ${m.text}`}>
      <span className={`inline-block w-2 h-2 rounded-full ${m.dot}`} aria-hidden />
      {m.label}
    </span>
  );
}

/** Participant Sigils, overlapped — the "people gathered around" glyph. */
function SigilStack({ slugs, size = 28 }: { slugs: string[]; size?: number }) {
  return (
    <span className="flex items-center -space-x-2" aria-hidden>
      {slugs.map((s) => (
        <span key={s} className="rounded-full ring-2 ring-wf-surface-container-lo">
          <Sigil slug={s} size={size} />
        </span>
      ))}
    </span>
  );
}

export default function Rooms() {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roster, setRoster] = useState<WorkforceAgent[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    document.title = `${SITE_DISPLAY_NAME} — Rooms`;
    if (!LIVE) return;
    fetchRooms({ pageSize: PAGE_SIZE })
      .then((p) => {
        setRooms(p.rooms);
        setCursor(p.cursor);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    loadWorkforceManifest()
      .then((m) => setRoster(m.agents))
      .catch((err) => setRosterError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function loadMore(): Promise<void> {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const p = await fetchRooms({ pageSize: PAGE_SIZE, cursor });
      setRooms((prev) => {
        const seen = new Set((prev ?? []).map((r) => r.room_id));
        return [...(prev ?? []), ...p.rooms.filter((r) => !seen.has(r.room_id))];
      });
      setCursor(p.cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const rosterMap = useMemo(() => new Map((roster ?? []).map((a) => [a.slug, a])), [roster]);
  const archivedCount = (rooms ?? []).filter((r) => r.archived).length;
  const visible = (rooms ?? []).filter((r) => showArchived || !r.archived);

  return (
    <WorkforceLayout>
      <div className="max-w-[880px] mx-auto">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5 sm:mb-6">
          <div className="min-w-0">
            <div className="font-wfmono text-[10px] uppercase tracking-[0.18em] text-wf-on-surface-variant">
              Deliberation
            </div>
            <h1 className="font-headline font-black tracking-tight text-2xl sm:text-3xl text-wf-on-surface">Rooms</h1>
            <p className="mt-1 text-sm text-wf-on-surface-variant max-w-prose leading-relaxed">
              A room is opened for a question. Summon members from the crew; they deliberate in bounded
              rounds and the chair writes the conclusion.
            </p>
          </div>
          {LIVE && CAN_WRITE && !creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="self-start sm:self-auto h-9 px-4 rounded-wf-sm bg-wf-primary text-wf-on-primary font-medium text-sm hover:opacity-90 shrink-0"
            >
              New room
            </button>
          )}
        </header>

        {!LIVE ? (
          <EmptyNote title="Rooms need the live API">
            Rooms are deliberations run by the live workforce — the agents speak through the agents-api and
            the room store lives there. This origin is the public mirror with no API configured, so there is
            nothing to show and nothing can be opened here. Sign in on the workforce console to use Rooms.
          </EmptyNote>
        ) : (
          <>
            {!CAN_WRITE && (
              <div className="mb-4 border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-3">
                <div className="font-wfmono text-[9px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1">
                  Disclosure · live read-only
                </div>
                <p className="text-[11px] text-wf-on-surface-variant leading-relaxed">
                  Rooms are live from the room store, read-only here — opening a room needs the operator login
                  (SigV4) the build didn&apos;t supply.
                </p>
              </div>
            )}

            {creating && CAN_WRITE && (
              <NewRoomPanel
                roster={roster}
                rosterError={rosterError}
                rosterMap={rosterMap}
                onCancel={() => setCreating(false)}
              />
            )}

            {error && (
              <div role="alert" className="mb-4 border border-wf-tertiary rounded-wf-md bg-wf-surface-container-lo p-3 text-sm text-wf-tertiary">
                Could not load rooms: {error}
              </div>
            )}

            {!error && rooms === null && <RoomListSkeleton />}

            {rooms !== null && (
              <>
                {archivedCount > 0 && (
                  <div className="mb-3 flex justify-end">
                    <button
                      type="button"
                      aria-pressed={showArchived}
                      onClick={() => setShowArchived((v) => !v)}
                      className={`font-wfmono text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 rounded-full border ${
                        showArchived
                          ? 'bg-wf-secondary text-wf-on-primary border-wf-secondary'
                          : 'border-wf-outline-variant text-wf-on-surface-variant hover:bg-wf-surface-container'
                      }`}
                    >
                      Archived · {archivedCount}
                    </button>
                  </div>
                )}
                {visible.length === 0 ? (
                  <EmptyNote title="No rooms yet">
                    {CAN_WRITE
                      ? 'Open a room for a question you want the crew to settle — "New room" above.'
                      : 'No room has been opened yet.'}
                  </EmptyNote>
                ) : (
                  <ul className="space-y-3">
                    {visible.map((r) => (
                      <li key={r.room_id}>
                        <RoomCard room={r} rosterMap={rosterMap} />
                      </li>
                    ))}
                  </ul>
                )}
                {cursor && (
                  <div className="mt-4 flex justify-center">
                    <button
                      type="button"
                      onClick={() => void loadMore()}
                      disabled={loadingMore}
                      className="font-wfmono text-[10px] uppercase tracking-[0.12em] px-3 py-1.5 rounded-full border border-wf-outline-variant text-wf-on-surface-variant hover:bg-wf-surface-container disabled:opacity-60"
                    >
                      {loadingMore ? 'Loading…' : 'Older rooms'}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </WorkforceLayout>
  );
}

function EmptyNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-5 sm:p-6">
      <div className="font-headline font-bold text-wf-on-surface">{title}</div>
      <p className="mt-1.5 text-sm text-wf-on-surface-variant leading-relaxed max-w-prose">{children}</p>
    </div>
  );
}

function RoomListSkeleton() {
  return (
    <LoadingRegion label="Loading rooms">
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-3 w-40 max-w-full" />
              <Skeleton className="h-3 w-20" />
            </div>
            <SkeletonText lines={2} className="mt-3" />
            <div className="mt-4 flex items-center gap-1">
              {Array.from({ length: 3 }, (_, j) => (
                <SkeletonCircle key={j} size={28} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

function RoomCard({ room, rosterMap }: { room: RoomSummary; rosterMap: Map<string, WorkforceAgent> }) {
  const chair = rosterMap.get(room.chair);
  // Only the room's own content carries its language; the card chrome
  // (status, counts) stays English like the rest of the console.
  const lang = questionLanguage(room.question);
  return (
    <Link
      to={`/rooms/${encodeURIComponent(room.room_id)}`}
      className={`block border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4 sm:p-5 hover:border-wf-outline transition-colors ${
        room.archived ? 'opacity-75' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 font-semibold text-sm text-wf-on-surface-variant truncate" lang={questionLanguage(room.title)}>
          {room.title}
        </div>
        <span className="shrink-0">
          <RoomStatusPill status={room.status} archived={room.archived} />
        </span>
      </div>
      <p lang={lang} className="mt-1.5 font-headline font-bold text-base sm:text-lg leading-snug text-wf-on-surface line-clamp-2">
        {room.question}
      </p>
      {room.status === 'concluded' && room.conclusion_preview && (
        <p lang={lang} className="mt-2 pl-3 border-l-2 border-wf-secondary text-[13px] text-wf-on-surface-variant leading-relaxed line-clamp-3">
          {previewText(room.conclusion_preview)}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <SigilStack slugs={room.participants} />
        <span className="font-wfmono text-[10px] text-wf-on-surface-variant">
          {room.turn_count} turns · {room.rounds} {room.rounds === 1 ? 'round' : 'rounds'}
          {chair ? ` · chair ${chair.first_name}` : ''} · {fmtDate(room.created_at)}
        </span>
      </div>
    </Link>
  );
}

// ── New room panel ─────────────────────────────────────────────────────

/** Picker ranking: slug prefix first, then name / role substring. */
function rankRoster(agents: WorkforceAgent[], query: string, exclude: string[], limit = 8): WorkforceAgent[] {
  const q = query.trim().toLowerCase();
  const pool = agents.filter((a) => !exclude.includes(a.slug));
  if (!q) return pool.slice(0, limit);
  const prefix = pool.filter((a) => a.slug.startsWith(q));
  const rest = pool.filter(
    (a) => !a.slug.startsWith(q) && (fullName(a).toLowerCase().includes(q) || a.role.toLowerCase().includes(q)),
  );
  return [...prefix, ...rest].slice(0, limit);
}

const LABEL = 'block font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1.5';
const INPUT =
  'w-full px-3 py-2 rounded-wf-sm border border-wf-outline bg-wf-surface-container-lo text-sm text-wf-on-surface placeholder:text-wf-on-surface-variant focus:outline-none focus:border-wf-primary';

function NewRoomPanel({
  roster,
  rosterError,
  rosterMap,
  onCancel,
}: {
  roster: WorkforceAgent[] | null;
  rosterError: string | null;
  rosterMap: Map<string, WorkforceAgent>;
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [context, setContext] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [chair, setChair] = useState('');
  const [rounds, setRounds] = useState(ROOM_DEFAULT_ROUNDS);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const questionRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    questionRef.current?.focus();
  }, []);

  // The chair must be one of the chosen; default (and fall back) to the first.
  useEffect(() => {
    if (!members.includes(chair)) setChair(members[0] ?? '');
  }, [members, chair]);

  // Archived agents can't be summoned (the backend rejects them); the list
  // route already hides them, this keeps the picker honest if it ever doesn't.
  const eligible = useMemo(
    () => (roster ?? []).filter((a) => (a as WorkforceAgent & { archived?: boolean }).archived !== true),
    [roster],
  );
  const full = members.length >= ROOM_MAX_PARTICIPANTS;
  const candidates = useMemo(() => rankRoster(eligible, pick, members), [eligible, pick, members]);

  const countOk = members.length >= ROOM_MIN_PARTICIPANTS && members.length <= ROOM_MAX_PARTICIPANTS;
  const canSubmit = question.trim().length > 0 && countOk && !busy;
  const calls = members.length * rounds + 1;

  function add(slug: string): void {
    setMembers((m) => (m.includes(slug) || m.length >= ROOM_MAX_PARTICIPANTS ? m : [...m, slug]));
    setPick('');
  }
  function remove(slug: string): void {
    setMembers((m) => m.filter((s) => s !== slug));
  }

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(null);
    const q = question.trim();
    try {
      const id = await createRoom({
        title: title.trim() || summarizeQuestion(q, 80),
        question: q,
        context: context.trim() || undefined,
        participants: members,
        chair: chair || members[0],
        rounds,
      });
      navigate(`/rooms/${encodeURIComponent(id)}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  function onFormKeyDown(e: KeyboardEvent<HTMLFormElement>): void {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  function onPickKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault(); // Enter in the search adds the top match, never submits
      if (!full && candidates[0]) add(candidates[0].slug);
    }
  }

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={onFormKeyDown}
      aria-label="New room"
      className="mb-6 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-lg p-4 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-headline font-bold text-lg text-wf-on-surface">New room</h2>
        <button
          type="button"
          onClick={onCancel}
          className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant hover:text-wf-on-surface"
        >
          Cancel
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="room-question" className={LABEL}>
            Question <span className="text-wf-tertiary">*</span>
          </label>
          <textarea
            id="room-question"
            ref={questionRef}
            required
            rows={3}
            maxLength={ROOM_QUESTION_MAX_CHARS}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What should the room decide? e.g. Should the console ship a dark theme before the public launch?"
            className={`${INPUT} resize-y font-headline text-base leading-snug`}
          />
          <div className="mt-1 font-wfmono text-[10px] text-wf-on-surface-variant text-right">
            {question.length} / {ROOM_QUESTION_MAX_CHARS}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="room-title" className={LABEL}>
              Title
            </label>
            <input
              id="room-title"
              type="text"
              maxLength={ROOM_TITLE_MAX_CHARS}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={question.trim() ? summarizeQuestion(question, 60) : 'Defaults to the question'}
              className={INPUT}
            />
          </div>
          <div>
            <span id="room-rounds-label" className={LABEL}>
              Rounds
            </span>
            <div role="radiogroup" aria-labelledby="room-rounds-label" className="inline-flex rounded-wf-sm border border-wf-outline overflow-hidden">
              {Array.from({ length: ROOM_MAX_ROUNDS }, (_, i) => i + 1).map((n) => {
                const on = rounds === n;
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setRounds(n)}
                    className={`h-9 w-12 font-wfmono text-sm border-l first:border-l-0 border-wf-outline ${
                      on ? 'bg-wf-primary text-wf-on-primary' : 'bg-wf-surface-container-lo text-wf-on-surface hover:bg-wf-surface-container'
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="room-context" className={LABEL}>
            Context <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <textarea
            id="room-context"
            rows={3}
            maxLength={ROOM_CONTEXT_MAX_CHARS}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Background the members should read first — constraints, numbers, links."
            className={`${INPUT} resize-y`}
          />
        </div>

        {/* Participants */}
        <div>
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <label htmlFor="room-pick" className={`${LABEL} mb-0`}>
              Members
            </label>
            <span
              className={`font-wfmono text-[10px] ${countOk ? 'text-wf-on-surface-variant' : 'text-wf-tertiary'}`}
              aria-live="polite"
            >
              {members.length} / {ROOM_MAX_PARTICIPANTS} · pick {ROOM_MIN_PARTICIPANTS}–{ROOM_MAX_PARTICIPANTS}
            </span>
          </div>

          {members.length > 0 && (
            <ul className="flex flex-wrap gap-2 mb-2" aria-label="Summoned members">
              {members.map((slug) => {
                const a = rosterMap.get(slug);
                return (
                  <li key={slug} className="inline-flex items-center gap-2 pl-1 pr-2 py-1 rounded-full bg-wf-surface-container max-w-full">
                    <Sigil slug={slug} size={24} />
                    <span className="min-w-0">
                      <span className="block text-sm leading-tight text-wf-on-surface truncate">{a ? fullName(a) : slug}</span>
                      {a && <span className="block text-[10px] leading-tight text-wf-on-surface-variant truncate">{a.role}</span>}
                    </span>
                    {slug === chair && (
                      <span className="font-wfmono text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-full bg-wf-tertiary text-wf-on-tertiary">
                        Chair
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(slug)}
                      aria-label={`Remove ${a ? fullName(a) : slug}`}
                      className="w-5 h-5 inline-flex items-center justify-center rounded-full text-wf-on-surface-variant hover:text-wf-on-surface hover:bg-wf-surface-container-hi"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <input
            id="room-pick"
            type="search"
            value={pick}
            disabled={full || roster === null}
            onChange={(e) => setPick(e.target.value)}
            onKeyDown={onPickKeyDown}
            placeholder={
              roster === null
                ? rosterError
                  ? 'Roster unavailable'
                  : 'Loading the crew…'
                : full
                  ? `Room is full (${ROOM_MAX_PARTICIPANTS})`
                  : 'Search the crew by name, slug or role…'
            }
            className={`${INPUT} disabled:opacity-60`}
          />
          {rosterError && (
            <div className="mt-1.5 font-wfmono text-[10px] text-wf-tertiary">Could not load the roster: {rosterError}</div>
          )}
          {roster !== null && !full && (
            <ul className="mt-2 border border-wf-outline-variant rounded-wf-sm divide-y divide-wf-outline-variant max-h-64 overflow-y-auto" aria-label="Crew">
              {candidates.length === 0 ? (
                <li className="px-3 py-3 font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                  No one matches.
                </li>
              ) : (
                candidates.map((a) => (
                  <li key={a.slug}>
                    <button
                      type="button"
                      onClick={() => add(a.slug)}
                      className="w-full text-left flex items-center gap-3 px-3 py-2 hover:bg-wf-surface-container"
                    >
                      <Sigil slug={a.slug} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-wf-on-surface truncate">{fullName(a)}</span>
                        <span className="block text-[11px] text-wf-on-surface-variant truncate">{a.role}</span>
                      </span>
                      <span className="font-wfmono text-[10px] text-wf-on-surface-variant shrink-0">{a.slug}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        <div>
          <label htmlFor="room-chair" className={LABEL}>
            Chair · writes the conclusion
          </label>
          <select
            id="room-chair"
            value={chair}
            disabled={members.length === 0}
            onChange={(e) => setChair(e.target.value)}
            className={`${INPUT} sm:w-auto sm:min-w-[16rem] disabled:opacity-60`}
          >
            {members.length === 0 && <option value="">Summon members first</option>}
            {members.map((slug) => {
              const a = rosterMap.get(slug);
              return (
                <option key={slug} value={slug}>
                  {a ? `${fullName(a)} — ${a.role}` : slug}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-wf-outline-variant flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="font-wfmono text-[10px] text-wf-on-surface-variant leading-relaxed">
          {members.length > 0
            ? `${members.length} members × ${rounds} ${rounds === 1 ? 'round' : 'rounds'} + conclusion = ${calls} model calls`
            : 'Each member speaks once per round; the chair then concludes.'}
          <span className="hidden sm:inline"> · ⌘/Ctrl+Enter to open</span>
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className={`h-10 px-5 rounded-wf-sm font-medium text-sm ${
            canSubmit ? 'bg-wf-primary text-wf-on-primary hover:opacity-90' : 'bg-wf-surface-container text-wf-on-surface-variant cursor-not-allowed'
          }`}
        >
          {busy ? 'Opening…' : 'Open room'}
        </button>
      </div>
      {submitError && (
        <div role="alert" className="mt-2 font-wfmono text-[11px] text-wf-tertiary">
          Could not open the room: {submitError}
        </div>
      )}
    </form>
  );
}
