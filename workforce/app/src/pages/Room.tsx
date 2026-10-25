// /rooms/:id — one room. Purpose-first: the QUESTION is the hero and the
// members are gathered around it; the transcript underneath is the record
// of how they got to the conclusion, grouped by round, not a chat log.
//
// Liveness is bounded polling, the same posture as /messaging and boards
// (ADR-0006): while the room is deliberating and the tab is visible we read
// `GET /rooms/{id}?after=<cursor>` every few seconds (the cursor trails the
// newest turn by an overlap window — see pollCursor), fold the tail in
// with `mergeTurns`, and take the fresh `room` (its status flips to
// concluded when the chair's turn lands — that stops the poll). If nothing
// moves for three minutes the page says so and offers "Conclude now"
// rather than spinning forever (W-4: a stall is visible, never silent).

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import WorkforceLayout from '../components/WorkforceLayout';
import Sigil from '../components/Sigil';
import { LoadingRegion, Skeleton, SkeletonCircle, SkeletonText } from '../components/Skeleton';
import { apiConfigured, fullName, loadWorkforceManifest } from '../lib/agents';
import {
  ROOM_OPERATOR_ID,
  ROOM_TURN_HARD_MAX_CHARS,
  concludeRoom,
  fetchRoom,
  groupTurnsByRound,
  isDeliberating,
  mergeTurns,
  freshTurns,
  followTail,
  nextPollHealth,
  paragraphsOf,
  patchRoom,
  pollCursor,
  pollErrorToShow,
  progressCopy,
  questionLanguage,
  roomsWriteEnabled,
  roundProgress,
  stallState,
  steerLocked,
  steerLockedCopy,
  steerRoom,
  type PollHealth,
  type RoomDetail,
  type RoomView,
  type RoundProgress,
  type TurnSection,
  type TurnView,
} from '../lib/rooms';
import { OPERATOR, SITE_DISPLAY_NAME } from '../config/site';
import type { WorkforceAgent } from '../types/agent';

const LIVE = apiConfigured();
const CAN_WRITE = roomsWriteEnabled();

/** Poll cadence while deliberating (a turn lands every ~10–40 s). */
const POLL_MS = 4000;
/** Once stalled (lib/rooms stallState), keep listening but back off — a late turn still lands. */
const STALLED_POLL_MS = 20_000;

/** The CONTENT language (the question's) — used only for `lang=` on
 *  content nodes. Console chrome is English-only. */
type Lang = 'ja' | 'en';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

// Monogram avatar for the human operator (distinct from agent Sigils) —
// the same mark /messaging uses.
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

function RoomStatusPill({ room }: { room: RoomView }) {
  const m = room.archived
    ? { label: 'Archived', dot: 'bg-wf-archived', text: 'text-wf-archived' }
    : room.status === 'debating'
      ? { label: 'Deliberating', dot: 'bg-wf-running', text: 'text-wf-running' }
      : { label: 'Concluded', dot: 'bg-wf-secondary', text: 'text-wf-secondary' };
  return (
    <span className={`inline-flex items-center gap-1.5 font-wfmono text-[10px] uppercase tracking-[0.14em] ${m.text}`}>
      <span className={`inline-block w-2 h-2 rounded-full ${m.dot}`} aria-hidden />
      {m.label}
    </span>
  );
}

function ChairBadge() {
  return (
    <span className="font-wfmono text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-full bg-wf-tertiary text-wf-on-tertiary shrink-0">
      Chair
    </span>
  );
}

const BTN_GHOST =
  'h-8 px-3 rounded-wf-sm border border-wf-outline text-[13px] font-medium text-wf-on-surface hover:bg-wf-surface-container disabled:opacity-50';
const BTN_PRIMARY =
  'h-8 px-3 rounded-wf-sm bg-wf-primary text-wf-on-primary text-[13px] font-medium hover:opacity-90 disabled:opacity-50';

export default function Room() {
  const { id = '' } = useParams<{ id: string }>();
  const [room, setRoom] = useState<RoomView | null>(null);
  const [turns, setTurns] = useState<TurnView[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [roster, setRoster] = useState<Map<string, WorkforceAgent>>(new Map());
  // When the room last visibly moved (new turn, status / run / error change).
  const [lastChangeAt, setLastChangeAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  // The run id "Conclude now" started — that run schedules only the chair,
  // which the turns alone can't tell apart from a fresh reopen.
  const [concludeRunId, setConcludeRunId] = useState<string | null>(null);
  const [confirmConclude, setConfirmConclude] = useState(false);
  const [busy, setBusy] = useState<'conclude' | 'archive' | null>(null);
  // Consecutive poll failures: after a few, the fetch error is shown, so a
  // read fault is not mistaken for a stopped schedule (W-4).
  const [pollHealth, setPollHealth] = useState<PollHealth>({ failures: 0 });
  // The newest turn that arrived while the page was open (a poll tail, a
  // steer's refresh) — the timeline scrolls to it so the debate visibly
  // moves on. Never set by the initial load, which opens at the top.
  const [arrivedTurnId, setArrivedTurnId] = useState<string | null>(null);
  // Every turn that arrived while the page was open (the animation class),
  // and whether the reader was following the tail when the last one did
  // (decided before the new card renders, so the geometry is the reader's).
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set());
  const followRef = useRef(true);

  const roomRef = useRef<RoomView | null>(null);
  const afterRef = useRef<string | undefined>(undefined);
  const turnIdsRef = useRef<Set<string>>(new Set());

  // Fold a fetch (full or `?after=` tail) into state; bump the change clock
  // when anything the operator would notice moved. The tail re-reads an
  // overlap window (pollCursor), so only turns not yet on screen count.
  const apply = useCallback((d: RoomDetail) => {
    const prev = roomRef.current;
    const fresh = freshTurns(d.turns, turnIdsRef.current);
    const moved =
      fresh.length > 0 ||
      !prev ||
      prev.status !== d.room.status ||
      prev.turn_count !== d.room.turn_count ||
      prev.run_id !== d.room.run_id ||
      prev.last_error !== d.room.last_error ||
      prev.archived !== d.room.archived;
    roomRef.current = d.room;
    setRoom(d.room);
    if (d.turns.length > 0) setTurns((t) => mergeTurns(t, d.turns));
    if (moved && prev) setLastChangeAt(Date.now());
    if (prev && fresh.length > 0) {
      const root = document.scrollingElement ?? document.documentElement;
      followRef.current = followTail({
        scrollTop: root.scrollTop,
        viewportHeight: window.innerHeight,
        scrollHeight: root.scrollHeight,
        composerFocused: document.activeElement?.id === 'room-steer',
      });
      setFreshIds((s) => new Set([...s, ...fresh.map((t) => t.turn_id)]));
      setArrivedTurnId(fresh[fresh.length - 1]!.turn_id);
    }
    // Every successful read comes through here, so the poll-failure banner
    // clears even when the read that succeeded was not a poll tick (an
    // archive, a steer): otherwise it could outlive polling itself.
    setPollHealth({ failures: 0 });
  }, []);

  useEffect(() => {
    afterRef.current = pollCursor(turns);
    turnIdsRef.current = new Set(turns.map((t) => t.turn_id));
  }, [turns]);

  // Initial load.
  useEffect(() => {
    document.title = `${SITE_DISPLAY_NAME} — Room`;
    if (!LIVE || !id) return;
    let cancelled = false;
    roomRef.current = null;
    setRoom(null);
    setTurns([]);
    setArrivedTurnId(null);
    setFreshIds(new Set());
    setNotFound(false);
    setLoadError(null);
    fetchRoom(id)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          setNotFound(true);
          return;
        }
        document.title = `${SITE_DISPLAY_NAME} — ${d.room.title}`;
        roomRef.current = d.room;
        setRoom(d.room);
        setTurns(mergeTurns([], d.turns));
        // Opening a room that has been quiet for a while should show the
        // stall immediately, not three minutes from now.
        const last = Date.parse(d.room.last_turn_at);
        setLastChangeAt(Number.isNaN(last) ? Date.now() : Math.min(last, Date.now()));
        setNow(Date.now());
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!LIVE) return;
    loadWorkforceManifest()
      .then((m) => setRoster(new Map(m.agents.map((a) => [a.slug, a]))))
      .catch(() => {
        /* names degrade to slugs — the room itself still renders */
      });
  }, []);

  const deliberating = isDeliberating(room);
  const stalled = stallState(now, lastChangeAt, room) === 'stalled';
  const pollError = pollErrorToShow(pollHealth);

  // Bring the turn that just landed into view — only for a reader who was
  // following the tail (followTail); smooth unless the OS asks for reduced
  // motion. `block: 'start'` + the card's `scroll-mt-20` clears the sticky
  // header so a long statement reads from its byline. The arrival animation
  // is the cue for everyone else.
  useEffect(() => {
    if (!arrivedTurnId || !followRef.current) return;
    const el = document.getElementById(turnDomId(arrivedTurnId));
    if (!el || typeof el.scrollIntoView !== 'function') return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, [arrivedTurnId]);

  // The clock the stall check reads — ticks only while deliberating.
  useEffect(() => {
    if (!deliberating) return;
    const t = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, [deliberating]);

  // Poll the tail while deliberating and the tab is visible.
  useEffect(() => {
    if (!LIVE || !id || !deliberating) return;
    let cancelled = false;
    let inflight = false;
    const tick = async () => {
      if (inflight || document.visibilityState !== 'visible') return;
      inflight = true;
      try {
        const d = await fetchRoom(id, { after: afterRef.current });
        if (!cancelled && d) apply(d);
        if (!cancelled) setPollHealth((h) => (h.failures === 0 ? h : nextPollHealth(h, { ok: true })));
      } catch (err) {
        // The next tick retries; a run of failures surfaces in the banner.
        const error = err instanceof Error ? err.message : String(err);
        if (!cancelled) setPollHealth((h) => nextPollHealth(h, { ok: false, error }));
      } finally {
        inflight = false;
      }
    };
    const iv = window.setInterval(tick, stalled ? STALLED_POLL_MS : POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id, deliberating, stalled, apply]);

  const refresh = useCallback(async () => {
    const d = await fetchRoom(id, { after: afterRef.current });
    if (d) apply(d);
  }, [id, apply]);

  async function handleConclude(): Promise<void> {
    setBusy('conclude');
    setActionError(null);
    try {
      const runId = await concludeRoom(id);
      if (runId) setConcludeRunId(runId);
      setConfirmConclude(false);
      setLastChangeAt(Date.now());
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleArchive(archived: boolean): Promise<void> {
    setBusy('archive');
    setActionError(null);
    try {
      const fresh = await patchRoom(id, { archived });
      roomRef.current = fresh;
      setRoom(fresh);
      setLastChangeAt(Date.now());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSteer(body: string): Promise<void> {
    const res = await steerRoom(id, body);
    if (res.reopened) setConcludeRunId(null);
    setLastChangeAt(Date.now());
    setNow(Date.now());
    await refresh();
  }

  const lang: Lang = room ? questionLanguage(room.question) : 'en';
  const sections = useMemo(() => groupTurnsByRound(turns), [turns]);
  // A conclusion-only run: the API says so (run_rounds 0), or we started it.
  const concluding = !!room && (room.run_rounds === 0 || (!!concludeRunId && concludeRunId === room.run_id));
  const progress = useMemo(
    () => (room ? roundProgress(room, turns, { concluding }) : null),
    [room, turns, concluding],
  );
  const locked = steerLocked(room, progress);

  const nameOf = (slug: string) => {
    if (slug === ROOM_OPERATOR_ID) return OPERATOR.name;
    const a = roster.get(slug);
    return a ? fullName(a) : slug;
  };
  const firstNameOf = (slug: string) => roster.get(slug)?.first_name ?? slug;

  const back = (
    <Link to="/rooms" className="inline-flex items-center gap-1 font-wfmono text-[11px] text-wf-on-surface-variant hover:text-wf-on-surface">
      <span aria-hidden>←</span> Rooms
    </Link>
  );

  if (!LIVE) {
    return (
      <WorkforceLayout>
        <div className="max-w-[880px] mx-auto">
          {back}
          <Note title="Rooms need the live API" className="mt-4">
            Rooms are deliberations run by the live workforce and stored behind the agents-api. This origin is
            the public mirror with no API configured, so the room can&apos;t be shown here.
          </Note>
        </div>
      </WorkforceLayout>
    );
  }

  return (
    <WorkforceLayout>
      <div className="max-w-[880px] mx-auto">
        {back}

        {loadError && (
          <div role="alert" className="mt-4 border border-wf-tertiary rounded-wf-md bg-wf-surface-container-lo p-3 text-sm text-wf-tertiary">
            Could not load the room: {loadError}
          </div>
        )}
        {notFound && <Note title="Room not found" className="mt-4">No room has this id — it may have been mistyped.</Note>}
        {!room && !notFound && !loadError && <RoomSkeleton />}

        {room && progress && (
          <>
            {/* ── Purpose-first header ── */}
            <header className="mt-4 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-lg p-4 sm:p-6">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap min-w-0">
                  <RoomStatusPill room={room} />
                  <span className="font-wfmono text-[10px] text-wf-on-surface-variant">
                    {fmtTime(room.created_at)}
                    {room.run_count > 1 ? ` · run ${room.run_count}` : ''}
                  </span>
                </div>
                {CAN_WRITE && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {deliberating && !confirmConclude && (
                      <button type="button" className={BTN_GHOST} onClick={() => setConfirmConclude(true)} disabled={busy !== null}>
                        Conclude now
                      </button>
                    )}
                    <button
                      type="button"
                      className={BTN_GHOST}
                      onClick={() => void handleArchive(!room.archived)}
                      disabled={busy !== null}
                    >
                      {busy === 'archive' ? 'Saving…' : room.archived ? 'Unarchive' : 'Archive'}
                    </button>
                  </div>
                )}
              </div>

              {confirmConclude && deliberating && (
                <ConcludeConfirm
                  chairName={nameOf(room.chair)}
                  busy={busy === 'conclude'}
                  onConfirm={() => void handleConclude()}
                  onCancel={() => setConfirmConclude(false)}
                />
              )}

              <div className="mt-4 font-semibold text-sm text-wf-on-surface-variant" lang={questionLanguage(room.title)}>
                {room.title}
              </div>
              <h1 lang={lang} className="mt-1 font-headline font-black tracking-tight text-2xl sm:text-[2rem] leading-tight text-wf-on-surface whitespace-pre-wrap break-words">
                {room.question}
              </h1>
              {room.context && (
                <p lang={lang} className="mt-3 text-sm text-wf-on-surface-variant leading-relaxed whitespace-pre-wrap max-w-prose">
                  {room.context}
                </p>
              )}

              <ul className="mt-5 flex flex-wrap gap-2" aria-label="Members">
                {room.participants.map((slug) => {
                  const a = roster.get(slug);
                  return (
                    <li key={slug} className="inline-flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border border-wf-outline-variant max-w-full">
                      <Sigil slug={slug} size={32} />
                      <span className="min-w-0">
                        <Link
                          to={`/agents/${slug}`}
                          className="block text-sm font-semibold leading-tight text-wf-on-surface hover:text-wf-primary truncate"
                        >
                          {nameOf(slug)}
                        </Link>
                        {a && <span className="block text-[11px] leading-tight text-wf-on-surface-variant truncate">{a.role}</span>}
                      </span>
                      {slug === room.chair && <ChairBadge />}
                    </li>
                  );
                })}
              </ul>
            </header>

            {room.last_error && (
              <div role="alert" className="mt-3 border border-wf-tertiary rounded-wf-md bg-wf-surface-container-lo p-3">
                <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">Last error</div>
                <p className="mt-1 text-sm text-wf-on-surface break-words">{room.last_error}</p>
                {deliberating && (
                  <p className="mt-1 text-[12px] text-wf-on-surface-variant">
                    A failed turn still hands the baton to the next speaker. If the room has stopped moving, conclude it.
                  </p>
                )}
              </div>
            )}
            {actionError && (
              <div role="alert" className="mt-3 font-wfmono text-[11px] text-wf-tertiary">
                {actionError}
              </div>
            )}

            <ProgressBand
              room={room}
              progress={progress}
              concluding={concluding}
              firstNameOf={firstNameOf}
            />

            {pollError && (
              <div role="alert" className="mt-3 border border-wf-tertiary rounded-wf-md bg-wf-surface-container-lo p-3">
                <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">Can&apos;t reach the room</div>
                <p className="mt-1 text-sm text-wf-on-surface break-words">{pollError}</p>
                <p className="mt-1 text-[12px] text-wf-on-surface-variant">
                  The last {pollHealth.failures} polls failed; the page keeps retrying. Until one succeeds, a stall here may be a
                  read fault, not a stopped schedule.
                </p>
              </div>
            )}

            {stalled && (
              <div className="mt-3 border border-wf-paused rounded-wf-md bg-wf-surface-container-lo p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <p className="text-sm text-wf-on-surface">
                  <span className="font-semibold">Stalled.</span>{' '}
                  <span className="text-wf-on-surface-variant">No new turn for three minutes — the schedule may have stopped.</span>
                </p>
                {CAN_WRITE && (
                  <button type="button" className={`${BTN_PRIMARY} self-start sm:self-auto shrink-0`} onClick={() => void handleConclude()} disabled={busy !== null}>
                    {busy === 'conclude' ? 'Concluding…' : 'Conclude now'}
                  </button>
                )}
              </div>
            )}

            {/* ── Deliberation record ── */}
            <section aria-label="Deliberation" className="mt-2">
              {sections.map((s) => (
                <SectionBlock
                  key={s.key}
                  section={s}
                  room={room}
                  roster={roster}
                  nameOf={nameOf}
                  lang={lang}
                  freshIds={freshIds}
                />
              ))}
              {progress.nextSpeaker && deliberating && (
                <div className="mt-4 flex items-center gap-3 text-[12px] text-wf-on-surface-variant font-wfmono">
                  <span className="opacity-60">
                    <Sigil slug={progress.nextSpeaker} size={28} />
                  </span>
                  <span>
                    {`${firstNameOf(progress.nextSpeaker)} is drafting`}
                  </span>
                  <span className="inline-flex gap-0.5" aria-hidden>
                    <span className="animate-bounce motion-reduce:animate-none [animation-delay:-0.3s]">·</span>
                    <span className="animate-bounce motion-reduce:animate-none [animation-delay:-0.15s]">·</span>
                    <span className="animate-bounce motion-reduce:animate-none">·</span>
                  </span>
                </div>
              )}
            </section>

            <Composer room={room} onSteer={handleSteer} locked={locked} />
          </>
        )}
      </div>
    </WorkforceLayout>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────

function Note({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-5 sm:p-6 ${className}`}>
      <div className="font-headline font-bold text-wf-on-surface">{title}</div>
      <p className="mt-1.5 text-sm text-wf-on-surface-variant leading-relaxed max-w-prose">{children}</p>
    </div>
  );
}

function RoomSkeleton() {
  return (
    <LoadingRegion label="Loading room">
      <div className="mt-4 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-lg p-4 sm:p-6">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-40 mt-5" />
        <Skeleton className="h-7 w-full mt-3" />
        <Skeleton className="h-7 w-3/5 mt-2" />
        <SkeletonText lines={2} className="mt-4 max-w-prose" />
        <div className="mt-5 flex gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <SkeletonCircle key={i} size={32} />
          ))}
        </div>
      </div>
      <Skeleton className="h-12 w-full mt-3 rounded-wf-md" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4">
            <div className="flex items-center gap-3">
              <SkeletonCircle size={40} />
              <Skeleton className="h-3 w-36" />
            </div>
            <SkeletonText lines={3} className="mt-3" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

function ConcludeConfirm({
  chairName,
  busy,
  onConfirm,
  onCancel,
}: {
  chairName: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <p className="text-sm text-wf-on-surface">
        Cut the debate short? {chairName} concludes from what has been said so far.
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <button type="button" className={BTN_PRIMARY} onClick={onConfirm} disabled={busy}>
          {busy ? 'Concluding…' : 'Conclude'}
        </button>
        <button type="button" className={BTN_GHOST} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ProgressBand({
  room,
  progress,
  concluding,
  firstNameOf,
}: {
  room: RoomView;
  progress: RoundProgress;
  concluding: boolean;
  firstNameOf: (s: string) => string;
}) {
  const copy = progressCopy(room, progress, concluding, firstNameOf);
  const live = isDeliberating(room);
  const spoken = new Set(progress.spoken);
  return (
    <div
      aria-live="polite"
      className="mt-3 border border-wf-outline-variant bg-wf-surface-container rounded-wf-md px-3 sm:px-4 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
    >
      <div className="min-w-0">
        <div className="font-wfmono text-[12px] text-wf-on-surface">{copy.line}</div>
        {live && copy.drafting && <div className="text-[12px] text-wf-on-surface-variant">{copy.drafting}</div>}
      </div>
      {live && progress.phase === 'debate' && (
        <ul className="flex items-center gap-1.5 shrink-0" aria-hidden>
          {room.participants.map((slug) => {
            const isNext = slug === progress.nextSpeaker;
            return (
              <li
                key={slug}
                className={`rounded-full ${spoken.has(slug) ? '' : 'opacity-40'} ${
                  isNext ? 'opacity-100 ring-2 ring-wf-primary animate-pulse motion-reduce:animate-none' : ''
                }`}
              >
                <Sigil slug={slug} size={22} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mt-7 mb-3" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-wf-outline-variant" aria-hidden />
      <span className="font-wfmono text-[10px] uppercase tracking-[0.18em] text-wf-on-surface-variant">{label}</span>
      <span className="h-px flex-1 bg-wf-outline-variant" aria-hidden />
    </div>
  );
}

/** DOM id of a turn's card — the scroll target when it arrives. */
function turnDomId(turnId: string): string {
  return `turn-${turnId}`;
}

function SectionBlock({
  section,
  room,
  roster,
  nameOf,
  lang,
  freshIds,
}: {
  section: TurnSection;
  room: RoomView;
  roster: Map<string, WorkforceAgent>;
  nameOf: (s: string) => string;
  lang: Lang;
  freshIds: ReadonlySet<string>;
}) {
  return (
    <div>
      <SectionDivider label={section.label} />
      <div className="space-y-3">
        {section.turns.map((t) => (
          <div
            key={t.turn_id}
            id={turnDomId(t.turn_id)}
            className={freshIds.has(t.turn_id) ? 'wf-turn-arrive scroll-mt-20' : 'scroll-mt-20'}
          >
            {t.kind === 'opening' ? (
              <OpeningRow turn={t} room={room} lang={lang} />
            ) : t.kind === 'steer' ? (
              <OperatorTurn turn={t} lang={lang} />
            ) : t.kind === 'conclusion' ? (
              <ConclusionCard turn={t} nameOf={nameOf} lang={lang} />
            ) : (
              <StatementCard
                turn={t}
                agent={roster.get(t.from)}
                nameOf={nameOf}
                isChair={t.from === room.chair}
                lang={lang}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OpeningRow({ turn, room, lang }: { turn: TurnView; room: RoomView; lang: Lang }) {
  // The opening's body is the question, already the page's hero — only
  // repeat it if it somehow differs.
  const differs = turn.body.trim() !== room.question.trim();
  return (
    <div className="flex gap-3 items-start">
      <OperatorAvatar size={32} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold text-sm text-wf-on-surface">{OPERATOR.name}</span>
          <span className="text-[12px] text-wf-on-surface-variant">
            opened the room on this question
          </span>
          <span className="font-wfmono text-[10px] text-wf-on-surface-variant">{fmtTime(turn.at)}</span>
        </div>
        {differs && <p lang={lang} className="mt-0.5 text-sm text-wf-on-surface leading-relaxed whitespace-pre-wrap">{turn.body}</p>}
      </div>
    </div>
  );
}

function OperatorTurn({ turn, lang }: { turn: TurnView; lang: Lang }) {
  return (
    <div className="flex gap-3 items-start">
      <OperatorAvatar size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold text-sm text-wf-on-surface">{OPERATOR.name}</span>
          <span className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant">
            Steer
          </span>
          <span className="font-wfmono text-[10px] text-wf-on-surface-variant">{fmtTime(turn.at)}</span>
        </div>
        <p lang={lang} className="mt-0.5 text-sm text-wf-on-surface leading-relaxed whitespace-pre-wrap break-words">{turn.body}</p>
      </div>
    </div>
  );
}

function StatementCard({
  turn,
  agent,
  nameOf,
  isChair,
  lang,
}: {
  turn: TurnView;
  agent?: WorkforceAgent;
  nameOf: (s: string) => string;
  isChair: boolean;
  lang: Lang;
}) {
  const paras = paragraphsOf(turn.body);
  return (
    <article className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4 sm:p-5">
      <header className="flex items-start gap-3">
        <Sigil slug={turn.from} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <Link to={`/agents/${turn.from}`} className="font-semibold text-sm text-wf-on-surface hover:text-wf-primary">
              {nameOf(turn.from)}
            </Link>
            {isChair && <ChairBadge />}
            <span className="font-wfmono text-[10px] text-wf-on-surface-variant">{fmtTime(turn.at)}</span>
          </div>
          {agent && <div className="text-[11px] text-wf-on-surface-variant truncate">{agent.role}</div>}
        </div>
      </header>
      {turn.position && (
        <p lang={lang} className="mt-3 font-headline font-bold text-[15px] leading-snug text-wf-on-surface">{turn.position}</p>
      )}
      <div lang={lang} className="mt-2 space-y-2.5 text-sm text-wf-on-surface leading-relaxed break-words">
        {paras.map((p, i) => (
          <p key={i} className="whitespace-pre-wrap">
            {p}
          </p>
        ))}
      </div>
    </article>
  );
}

function ConclusionCard({ turn, nameOf, lang }: { turn: TurnView; nameOf: (s: string) => string; lang: Lang }) {
  return (
    <article className="border border-wf-primary bg-wf-surface-container-lo rounded-wf-lg overflow-hidden">
      <header className="bg-wf-primary text-wf-on-primary px-4 sm:px-5 py-2.5 flex items-center gap-3 flex-wrap">
        <span className="font-wfmono text-[11px] uppercase tracking-[0.18em]">Conclusion</span>
        <span className="text-[12px] opacity-90">
          {nameOf(turn.from)} · chair
        </span>
        <span className="ml-auto font-wfmono text-[10px] opacity-80">{fmtTime(turn.at)}</span>
      </header>
      <div lang={lang} className="px-4 sm:px-6 py-4 skill-md-body break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.body}</ReactMarkdown>
      </div>
    </article>
  );
}

function Composer({
  room,
  onSteer,
  locked,
}: {
  room: RoomView;
  onSteer: (body: string) => Promise<void>;
  /** Only the chair's conclusion is left — a steer now would go unread. */
  locked: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!CAN_WRITE) {
    return (
      <div className="mt-8 border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-3">
        <div className="font-wfmono text-[9px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1">
          Disclosure · live read-only
        </div>
        <p className="text-[11px] text-wf-on-surface-variant leading-relaxed">
          This room is live from the room store, read-only here — steering needs the operator login (SigV4) the build
          didn&apos;t supply.
        </p>
      </div>
    );
  }
  if (room.archived) {
    return (
      <div className="mt-8 font-wfmono text-[11px] text-wf-on-surface-variant">
        Archived rooms are read-only. Unarchive to steer or reopen.
      </div>
    );
  }

  const reopen = room.status === 'concluded';
  const canSubmit = draft.trim().length > 0 && !sending && !locked;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    try {
      await onSteer(draft.trim());
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="mt-8 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4">
      <label htmlFor="room-steer" className="block font-headline font-bold text-sm text-wf-on-surface">
        {reopen ? 'Reopen with a follow-up' : 'Steer the room'}
      </label>
      {locked ? (
        <p className="mt-0.5 text-[12px] text-wf-on-surface-variant leading-relaxed">
          {steerLockedCopy()}
        </p>
      ) : (
        <p className="mt-0.5 text-[12px] text-wf-on-surface-variant leading-relaxed">
          {reopen
            ? 'Each member speaks once more on your follow-up, then the chair writes a fresh conclusion.'
            : 'A direction for the members still to speak — they read it before their turn.'}
        </p>
      )}
      <textarea
        id="room-steer"
        disabled={locked}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        maxLength={ROOM_TURN_HARD_MAX_CHARS}
        placeholder={reopen ? 'What should the room look at next?' : 'e.g. Focus on the cost side; assume the launch date is fixed.'}
        className="mt-2 w-full resize-y px-3 py-2 rounded-wf-sm border border-wf-outline bg-wf-surface-container-lo text-sm text-wf-on-surface placeholder:text-wf-on-surface-variant focus:outline-none focus:border-wf-primary disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="hidden sm:inline font-wfmono text-[10px] text-wf-on-surface-variant">⌘/Ctrl+Enter to send</span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className={`ml-auto h-9 px-4 rounded-wf-sm text-sm font-medium ${
            canSubmit ? 'bg-wf-primary text-wf-on-primary hover:opacity-90' : 'bg-wf-surface-container text-wf-on-surface-variant cursor-not-allowed'
          }`}
        >
          {sending ? 'Sending…' : reopen ? 'Reopen' : 'Steer'}
        </button>
      </div>
      {error && <div className="mt-1.5 font-wfmono text-[10px] text-wf-tertiary">Could not send: {error}</div>}
    </div>
  );
}
