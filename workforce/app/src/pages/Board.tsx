// /boards/:id — a public, password-gated Q&A board (ADR-0034).
//
// Renders outside AuthBoundary (with /, /research, /docs): guests have no
// Cognito account. The gate asks for the board's shared password and a
// nickname; the API answers with a board-scoped token the page keeps in
// localStorage. After that the page is a flat, Discord-style timeline —
// every post and every reply in one chronological stream (a reply shows
// an inline quote of its parent, nothing is folded away) — with a
// composer that offers @-completion over the board's agent roster.
// Mentioned agents answer within seconds; the page polls `?after=` every
// few seconds while the tab is visible and shows who is drafting.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import Sigil from '../components/Sigil';
import { SITE_DISPLAY_NAME } from '../config/site';
import {
  BoardApiError,
  applyMention,
  clearBoardSession,
  createPost,
  enterBoard,
  fetchBoard,
  fetchPosts,
  fetchPostsAfter,
  initialsOf,
  loadBoardSession,
  mergePosts,
  probeMention,
  rankAgents,
  saveBoardSession,
  splitMentions,
  type BoardAgent,
  type BoardInfo,
  type BoardPost,
  type BoardSession,
  type MentionProbe,
} from '../lib/boards';

const POLL_MS = 4000;
/** How long "drafting…" stays up for a summoned agent before we stop
 *  promising an answer (the reply Lambda usually lands in 10–40 s; a
 *  delegated second answer can take a minute). */
const DRAFTING_MS = 150_000;
const BOARD_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const BODY_MAX = 4000;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

function GuestAvatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-wf-surface-container-hi text-wf-on-surface font-headline font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}

function Body({ text, known }: { text: string; known: ReadonlySet<string> }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div className="space-y-2 text-[15px] leading-[1.65] text-wf-on-surface break-words">
      {paragraphs.map((para, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {splitMentions(para, known).map((seg, j) =>
            seg.kind === 'mention' ? (
              <span key={j} className="font-wfmono text-[13px] px-1 rounded-wf-sm bg-wf-surface-container text-wf-primary">
                {seg.text}
              </span>
            ) : (
              <span key={j}>{seg.text}</span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

interface GateProps {
  boardId: string;
  notice?: string;
  onEntered: (session: BoardSession, board: BoardInfo) => void;
}

function Gate({ boardId, notice, onEntered }: GateProps) {
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState(() => loadBoardSession(boardId)?.nickname ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { session, board } = await enterBoard(boardId, password, nickname);
      saveBoardSession(boardId, session);
      onEntered(session, board);
    } catch (err) {
      if (err instanceof BoardApiError) {
        if (err.code === 'invalid_password') setError('パスワードが違います / Wrong password.');
        else if (err.code === 'invalid_nickname') setError('ニックネームは1〜32文字、先頭に @ は使えません / Nickname: 1–32 chars, no leading @.');
        else if (err.status === 404) setError('このボードは存在しません / This board does not exist.');
        else if (err.status === 410) setError('このボードは閉鎖されました / This board has been closed.');
        else setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-wf-surface text-wf-on-surface flex flex-col">
      <header className="w-full max-w-3xl mx-auto px-6 py-5 flex items-center gap-2">
        <Link to="/" className="flex items-center gap-2 group" aria-label={SITE_DISPLAY_NAME}>
          <BrandMark size={26} />
          <span className="font-headline font-bold text-[15px] group-hover:text-wf-primary">{SITE_DISPLAY_NAME}</span>
        </Link>
      </header>
      <main className="flex-1 w-full max-w-md mx-auto px-6 pt-10 pb-16">
        <p className="font-wfmono text-[11px] uppercase tracking-[0.2em] text-wf-on-surface-variant">Q&amp;A board</p>
        <h1 className="font-headline font-bold text-[28px] tracking-[-0.02em] mt-2">エージェントに聞く</h1>
        <p className="text-[14.5px] text-wf-on-surface-variant mt-3">
          招待されたボードです。共有パスワードと、このボードで使うニックネームを入力してください。
          <br />
          <span className="text-[13px]">Invited board. Enter the shared password and the nickname you want to use here.</span>
        </p>
        {notice && (
          <p className="mt-4 text-[13px] px-3 py-2 rounded-wf-sm bg-wf-surface-container text-wf-on-surface-variant">{notice}</p>
        )}
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block">
            <span className="font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-on-surface-variant">Password / パスワード</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1.5 w-full px-3 py-2.5 rounded-wf-sm border border-wf-outline-variant bg-wf-surface-container-lo text-[15px] focus:outline-none focus:border-wf-primary"
            />
          </label>
          <label className="block">
            <span className="font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-on-surface-variant">Nickname / ニックネーム</span>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={32}
              required
              placeholder="例: Hana / e.g. Hana"
              className="mt-1.5 w-full px-3 py-2.5 rounded-wf-sm border border-wf-outline-variant bg-wf-surface-container-lo text-[15px] focus:outline-none focus:border-wf-primary"
            />
          </label>
          {error && <p className="text-[13px] text-wf-throwing">{error}</p>}
          <button
            type="submit"
            disabled={busy || password.length === 0 || nickname.trim().length === 0}
            className="font-wfmono text-[12px] uppercase tracking-[0.16em] px-6 py-3 rounded-full bg-wf-primary text-wf-on-primary hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Entering…' : 'Enter / 入室する'}
          </button>
        </form>
      </main>
    </div>
  );
}

interface ComposerProps {
  agents: BoardAgent[];
  replyTo?: BoardPost;
  onCancelReply: () => void;
  onSend: (body: string) => Promise<void>;
}

function Composer({ agents, replyTo, onCancelReply, onSend }: ComposerProps) {
  const [text, setText] = useState('');
  const [probe, setProbe] = useState<MentionProbe | undefined>(undefined);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const candidates = useMemo(() => (probe ? rankAgents(agents, probe.query) : []), [agents, probe]);

  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  function refreshProbe(value: string, caret: number) {
    setText(value);
    const p = probeMention(value, caret);
    setProbe(p);
    setPick(0);
  }

  function choose(agent: BoardAgent) {
    if (!probe) return;
    const next = applyMention(text, probe, agent.slug);
    setText(next.text);
    setProbe(undefined);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      }
    });
  }

  async function send() {
    const body = text.trim();
    if (body.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(body);
      setText('');
      setProbe(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (probe && candidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPick((i) => (i + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPick((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(candidates[pick] ?? candidates[0]);
        return;
      }
      if (e.key === 'Escape') {
        setProbe(undefined);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="border-t border-wf-outline-variant bg-wf-surface-container-lo px-4 sm:px-6 py-3">
      {replyTo && (
        <div className="flex items-center gap-2 text-[12.5px] text-wf-on-surface-variant mb-2">
          <span className="font-wfmono text-[11px] uppercase tracking-[0.12em]">Replying to</span>
          <span className="font-semibold text-wf-on-surface">{replyTo.author_kind === 'agent' ? `@${replyTo.author}` : replyTo.author}</span>
          <span className="truncate max-w-[40ch]">{replyTo.body.slice(0, 80)}</span>
          <button type="button" onClick={onCancelReply} className="ml-auto font-wfmono text-[11px] uppercase tracking-[0.12em] hover:text-wf-on-surface">
            Cancel
          </button>
        </div>
      )}
      <div className="relative">
        {probe && candidates.length > 0 && (
          <ul
            role="listbox"
            className="absolute bottom-full left-0 mb-1 w-full max-w-sm bg-wf-surface-container-lo border border-wf-outline-variant rounded-wf-md shadow-none overflow-hidden z-10"
          >
            {candidates.map((a, i) => (
              <li key={a.slug} role="option" aria-selected={i === pick}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(a);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left ${i === pick ? 'bg-wf-surface-container' : 'hover:bg-wf-surface-container'}`}
                >
                  <Sigil slug={a.slug} size={28} />
                  <span className="font-wfmono text-[12px] text-wf-primary">@{a.slug}</span>
                  <span className="text-[13px] text-wf-on-surface truncate">{a.name}</span>
                  <span className="text-[12px] text-wf-on-surface-variant truncate ml-auto">{a.role}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={ref}
          value={text}
          rows={3}
          maxLength={BODY_MAX}
          placeholder="質問や意見をどうぞ。@ でエージェントを呼べます / Ask or comment; type @ to summon an agent."
          onChange={(e) => refreshProbe(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyUp={(e) => setProbe(probeMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0))}
          onClick={(e) => setProbe(probeMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0))}
          onKeyDown={onKeyDown}
          className="w-full px-3 py-2.5 rounded-wf-sm border border-wf-outline-variant bg-wf-surface text-[15px] leading-[1.6] resize-y focus:outline-none focus:border-wf-primary"
        />
      </div>
      <div className="flex items-center gap-3 mt-2">
        <span className="text-[12px] text-wf-on-surface-variant">
          ⌘/Ctrl + Enter で送信 · {text.length}/{BODY_MAX}
        </span>
        {error && <span className="text-[12.5px] text-wf-throwing truncate">{error}</span>}
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || text.trim().length === 0}
          className="ml-auto font-wfmono text-[11px] uppercase tracking-[0.16em] px-5 py-2 rounded-full bg-wf-primary text-wf-on-primary hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Post / 投稿'}
        </button>
      </div>
    </div>
  );
}

export default function Board() {
  const { id: rawId = '' } = useParams<{ id: string }>();
  const boardId = rawId.toLowerCase();
  const validId = BOARD_ID_RE.test(boardId);

  const [session, setSession] = useState<BoardSession | undefined>(() => (validId ? loadBoardSession(boardId) : undefined));
  const [board, setBoard] = useState<BoardInfo | null>(null);
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [replyTo, setReplyTo] = useState<BoardPost | undefined>(undefined);
  // slug → epoch ms until which we show "drafting…"
  const [drafting, setDrafting] = useState<Record<string, number>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const agentMap = useMemo(() => new Map((board?.agents ?? []).map((a) => [a.slug, a])), [board]);
  const known = useMemo(() => new Set(agentMap.keys()), [agentMap]);

  const bail = useCallback(
    (err: unknown) => {
      if (err instanceof BoardApiError && (err.status === 401 || err.status === 410)) {
        clearBoardSession(boardId);
        setSession(undefined);
        setNotice(
          err.status === 410
            ? 'このボードは閉鎖されました / This board has been closed.'
            : 'セッションの有効期限が切れました。もう一度入室してください / Your session expired — please enter again.',
        );
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    },
    [boardId],
  );

  useEffect(() => {
    document.title = board ? `${board.name} — ${SITE_DISPLAY_NAME}` : `Q&A board — ${SITE_DISPLAY_NAME}`;
  }, [board]);

  // Initial load once a session exists: board card + newest page.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const [info, page] = await Promise.all([fetchBoard(boardId, session.token), fetchPosts(boardId, session.token)]);
        if (cancelled) return;
        setBoard(info);
        setPosts(page.posts);
        setOlderCursor(page.older_cursor);
        setError(null);
      } catch (err) {
        if (!cancelled) bail(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, boardId, bail]);

  // Poll for posts newer than the last one we hold, while visible.
  const lastId = posts.length > 0 ? posts[posts.length - 1].post_id : undefined;
  useEffect(() => {
    if (!session || !board) return;
    let cancelled = false;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const fresh = lastId
          ? await fetchPostsAfter(boardId, session.token, lastId)
          : (await fetchPosts(boardId, session.token)).posts;
        if (cancelled || fresh.length === 0) return;
        setPosts((prev) => mergePosts(prev, fresh));
        setDrafting((prev) => {
          const next = { ...prev };
          for (const p of fresh) if (p.author_kind === 'agent') delete next[p.author];
          return next;
        });
      } catch (err) {
        if (!cancelled && err instanceof BoardApiError && err.status === 401) bail(err);
      }
    };
    const handle = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [session, board, boardId, lastId, bail]);

  // Expire stale "drafting…" chips.
  useEffect(() => {
    const ids = Object.keys(drafting);
    if (ids.length === 0) return;
    const handle = window.setInterval(() => {
      const now = Date.now();
      setDrafting((prev) => {
        const next: Record<string, number> = {};
        for (const [slug, until] of Object.entries(prev)) if (until > now) next[slug] = until;
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 5000);
    return () => window.clearInterval(handle);
  }, [drafting]);

  // Keep the newest post in view unless the reader scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [posts]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadOlder() {
    if (!session || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await fetchPosts(boardId, session.token, { cursor: olderCursor });
      stickToBottom.current = false;
      setPosts((prev) => mergePosts(page.posts, prev));
      setOlderCursor(page.older_cursor);
    } catch (err) {
      bail(err);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(body: string) {
    if (!session) return;
    const res = await createPost(boardId, session.token, body, replyTo?.post_id);
    stickToBottom.current = true;
    setPosts((prev) => mergePosts(prev, [res.post]));
    setReplyTo(undefined);
    if (res.dispatched.length > 0) {
      const until = Date.now() + DRAFTING_MS;
      setDrafting((prev) => ({ ...prev, ...Object.fromEntries(res.dispatched.map((s) => [s, until])) }));
    }
  }

  function leave() {
    clearBoardSession(boardId);
    setSession(undefined);
    setBoard(null);
    setPosts([]);
    setNotice(undefined);
  }

  function scrollTo(postId: string) {
    const el = document.getElementById(`post-${postId}`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('ring-1', 'ring-wf-primary');
      window.setTimeout(() => el.classList.remove('ring-1', 'ring-wf-primary'), 1500);
    }
  }

  if (!validId) {
    return (
      <div className="min-h-screen bg-wf-surface text-wf-on-surface flex items-center justify-center px-6">
        <p className="text-wf-on-surface-variant">Not a valid board address. / ボードのアドレスが正しくありません。</p>
      </div>
    );
  }

  if (!session) {
    return (
      <Gate
        boardId={boardId}
        notice={notice}
        onEntered={(s, b) => {
          setNotice(undefined);
          setSession(s);
          setBoard(b);
        }}
      />
    );
  }

  const draftingSlugs = Object.keys(drafting);

  return (
    <div className="h-screen bg-wf-surface text-wf-on-surface flex flex-col">
      <header className="shrink-0 border-b border-wf-outline-variant bg-wf-surface-container-lo">
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 group shrink-0" aria-label={SITE_DISPLAY_NAME}>
            <BrandMark size={24} />
          </Link>
          <div className="min-w-0">
            <div className="font-headline font-bold text-[15px] truncate">{board?.name ?? 'Q&A board'}</div>
            <div className="font-wfmono text-[10.5px] uppercase tracking-[0.14em] text-wf-on-surface-variant truncate">
              {board ? `${board.agents.length} agents · @ to ask` : 'loading…'}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3 shrink-0">
            <span className="flex items-center gap-2 text-[13px]">
              <GuestAvatar name={session.nickname} size={26} />
              <span className="hidden sm:inline font-semibold">{session.nickname}</span>
            </span>
            <button
              type="button"
              onClick={leave}
              className="font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-on-surface-variant hover:text-wf-on-surface"
            >
              Leave
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="shrink-0 bg-wf-surface-container text-[13px] text-wf-throwing px-4 sm:px-6 py-2">
          <div className="w-full max-w-4xl mx-auto">{error}</div>
        </div>
      )}

      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-4">
          {olderCursor && (
            <div className="text-center mb-4">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="font-wfmono text-[11px] uppercase tracking-[0.14em] px-4 py-1.5 rounded-full border border-wf-outline-variant text-wf-on-surface-variant hover:border-wf-primary hover:text-wf-primary disabled:opacity-50"
              >
                {loadingOlder ? 'Loading…' : 'Load earlier posts / 以前の投稿'}
              </button>
            </div>
          )}
          {board && posts.length === 0 && (
            <div className="py-16 text-center text-[14.5px] text-wf-on-surface-variant">
              <p>まだ投稿はありません。最初の質問をどうぞ。</p>
              <p className="text-[13px] mt-1">No posts yet — ask the first question. Type @ to pick an agent.</p>
            </div>
          )}
          <ol className="space-y-1">
            {posts.map((p) => {
              const agent = p.author_kind === 'agent' ? agentMap.get(p.author) : undefined;
              const name = p.author_kind === 'agent' ? (agent?.name ?? `@${p.author}`) : p.author;
              return (
                <li
                  key={p.post_id}
                  id={`post-${p.post_id}`}
                  className="group flex gap-3 px-2 py-2 rounded-wf-md hover:bg-wf-surface-container-lo transition-colors"
                >
                  <div className="pt-0.5">
                    {p.author_kind === 'agent' ? <Sigil slug={p.author} size={36} /> : <GuestAvatar name={p.author} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    {p.reply_to && (
                      <button
                        type="button"
                        onClick={() => scrollTo(p.reply_to!)}
                        className="flex items-center gap-1.5 max-w-full text-[12px] text-wf-on-surface-variant hover:text-wf-on-surface mb-0.5"
                        title="Jump to the post this replies to"
                      >
                        <span aria-hidden>↩</span>
                        <span className="font-semibold shrink-0">
                          {p.reply_to_author_kind === 'agent'
                            ? (agentMap.get(p.reply_to_author ?? '')?.name ?? `@${p.reply_to_author}`)
                            : p.reply_to_author}
                        </span>
                        <span className="truncate">{p.reply_to_preview ?? ''}</span>
                      </button>
                    )}
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-headline font-bold text-[14.5px]">{name}</span>
                      {agent && (
                        <span className="font-wfmono text-[10.5px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-wf-sm bg-wf-surface-container text-wf-on-surface-variant">
                          {agent.role}
                        </span>
                      )}
                      {p.author_kind === 'human' && (
                        <span className="font-wfmono text-[10.5px] uppercase tracking-[0.12em] text-wf-on-surface-variant">guest</span>
                      )}
                      <span className="font-wfmono text-[11px] text-wf-on-surface-variant">{fmtTime(p.at)}</span>
                      <button
                        type="button"
                        onClick={() => setReplyTo(p)}
                        className="ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100 font-wfmono text-[11px] uppercase tracking-[0.12em] text-wf-on-surface-variant hover:text-wf-primary"
                      >
                        Reply
                      </button>
                    </div>
                    <div className="mt-1">
                      <Body text={p.body} known={known} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {draftingSlugs.length > 0 && (
            <ul className="mt-2 space-y-1">
              {draftingSlugs.map((slug) => (
                <li key={slug} className="flex items-center gap-3 px-2 py-2 text-[13px] text-wf-on-surface-variant">
                  <Sigil slug={slug} size={28} />
                  <span>
                    <span className="font-semibold text-wf-on-surface">{agentMap.get(slug)?.name ?? `@${slug}`}</span> is drafting an answer…
                  </span>
                  <span className="inline-flex gap-1" aria-hidden>
                    <span className="w-1.5 h-1.5 rounded-full bg-wf-outline animate-pulse" />
                    <span className="w-1.5 h-1.5 rounded-full bg-wf-outline animate-pulse [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-wf-outline animate-pulse [animation-delay:300ms]" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="shrink-0">
        <div className="w-full max-w-4xl mx-auto">
          <Composer agents={board?.agents ?? []} replyTo={replyTo} onCancelReply={() => setReplyTo(undefined)} onSend={send} />
        </div>
      </div>
    </div>
  );
}
