// One chapter of a web book (/books/:slug/:chapterId) — the reading view.
// Public; lazy-loaded from App.tsx (react-markdown + the chapter chunk are
// only paid for by someone actually reading).
//
// Chrome is BookShell, not PublicShell (see that file). This page owns the
// chapter body and the reader's memory:
//   - On arrival: a `#h-<n>` hash wins; else, when the cover sent the
//     reader here with `?resume=1` and the stored position is this
//     chapter, the position is restored; else the top.
//   - While reading: a throttled (500ms) scroll handler stores the
//     position (nearest heading above the viewport top + scroll ratio) and
//     the chapter's furthest read ratio; reaching the footer marks the
//     chapter done. Leaving the page (pagehide / tab hidden) flushes.
//   - ← / → move to the previous / next chapter.
// A chapter that cannot be loaded, or is empty, is an error card naming
// the chapter (C-4) — never a blank page.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PublicShell from '../components/PublicShell';
import BookShell from '../components/book/BookShell';
import BookMarkdown from '../components/book/BookMarkdown';
import { BookErrorCard } from '../components/book/blocks';
import { CARD, KICKER_ACCENT, TEXT_LINK } from '../components/public/styles';
import { SITE_DISPLAY_NAME } from '../config/site';
import { useAsync } from '../lib/useAsync';
import {
  bookPath,
  chapterPath,
  figureRefs,
  findBook,
  flattenChapters,
  loadChapter,
  loadFigure,
  neighbours,
  type BookMeta,
  type FlatChapter,
} from '../lib/books';
import {
  markProgress,
  readPosition,
  readProgress,
  readSettings,
  writePosition,
  writeSettings,
  type BookPosition,
  type BookSettings,
} from '../lib/bookPosition';

/** The top bar's height plus a little air: a heading at or above this line
 *  is "the one being read". Also used when scrolling a heading into place. */
const READING_LINE = 56;
const SAVE_THROTTLE_MS = 500;
const HEADINGS = 'h1[id^="h-"], h2[id^="h-"], h3[id^="h-"], h4[id^="h-"]';

function scrollRatio(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
}

function headingsOf(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(HEADINGS)) : [];
}

function docTop(el: HTMLElement): number {
  return el.getBoundingClientRect().top + window.scrollY - READING_LINE;
}

/** Id of the last heading at or above the reading line. A scan over the
 *  chapter's twenty-odd headings every 500ms is cheaper and more exact than
 *  keeping IntersectionObserver state in sync in both scroll directions. */
function currentAnchor(root: HTMLElement | null): string | null {
  let id: string | null = null;
  for (const h of headingsOf(root)) {
    if (h.getBoundingClientRect().top <= READING_LINE) id = h.id;
    else break;
  }
  return id;
}

/** Where a stored position lands: the anchor heading, refined by the
 *  stored ratio when that ratio still falls inside the anchor's section
 *  (same layout). When it does not — a different font size, a narrower
 *  screen — the heading alone is the honest place to resume. */
function restoreTarget(pos: BookPosition, root: HTMLElement | null): number {
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const byRatio = pos.ratio * max;
  const anchor = pos.anchor ? document.getElementById(pos.anchor) : null;
  if (!anchor) return byRatio;
  const all = headingsOf(root);
  const next = all[all.indexOf(anchor) + 1];
  const start = docTop(anchor);
  const end = next ? docTop(next) : max;
  return byRatio >= start && byRatio <= end ? byRatio : Math.max(0, start);
}

function NotFound({ slug, chapterId, book }: { slug: string; chapterId: string; book?: BookMeta }) {
  return (
    <PublicShell>
      <div className={`mt-10 ${CARD} p-6`}>
        <p className={KICKER_ACCENT}>Not found</p>
        <h1 className="mt-2 font-headline font-bold text-2xl">
          {book ? `「${book.title}」に章 “${chapterId}” はありません。` : `There is no book called “${slug}”.`}
        </h1>
        <Link to={book ? bookPath(book.slug) : '/books'} className={`inline-block mt-5 ${TEXT_LINK} underline underline-offset-2`}>
          {book ? '← 目次へ' : '← All books'}
        </Link>
      </div>
    </PublicShell>
  );
}

export default function BookChapter() {
  const { slug = '', chapterId = '' } = useParams<{ slug: string; chapterId: string }>();
  const book = findBook(slug);
  const chapters = book ? flattenChapters(book) : [];
  const chapter = chapters.find(c => c.id === chapterId);
  if (!book || !chapter) return <NotFound slug={slug} chapterId={chapterId} book={book} />;
  return <ChapterReader book={book} chapters={chapters} chapter={chapter} />;
}

/** Load the body and preload its figures, so the body renders whole on its
 *  first paint and a restored position is not shifted by late figures.
 *  A figure that fails is left for FigureBlock to report in place. */
async function loadReadable(book: BookMeta, chapter: FlatChapter) {
  const markdown = await loadChapter(book, chapter);
  await Promise.all(figureRefs(markdown).map(src => loadFigure(book, src).catch(() => undefined)));
  return { id: chapter.id, markdown };
}

function ChapterReader({ book, chapters, chapter }: { book: BookMeta; chapters: FlatChapter[]; chapter: FlatChapter }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();
  const resume = search.get('resume') === '1';
  const { prev, next } = neighbours(book, chapter.id);

  const [settings, setSettings] = useState<BookSettings>(readSettings);
  const [progress, setProgress] = useState<Record<string, number>>(() => readProgress(book.slug));
  const articleRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);

  const body = useAsync(() => loadReadable(book, chapter), [book.slug, chapter.id]);
  // useAsync keeps the previous chapter's data for one render after the
  // id changes; never paint chapter A's body under chapter B's chrome.
  const markdown = body.data?.id === chapter.id ? body.data.markdown : null;
  const ready = markdown !== null;

  const onSettingsChange = useCallback((nextSettings: BookSettings) => {
    setSettings(nextSettings);
    writeSettings(nextSettings);
  }, []);

  const recordProgress = useCallback(
    (ratio: number) => {
      const stored = markProgress(book.slug, chapter.id, ratio);
      setProgress(prevMap => (prevMap[chapter.id] === stored[chapter.id] ? prevMap : stored));
    },
    [book.slug, chapter.id],
  );

  const savePosition = useCallback(() => {
    const ratio = scrollRatio();
    writePosition(book.slug, { chapterId: chapter.id, anchor: currentAnchor(articleRef.current), ratio, at: Date.now() });
    recordProgress(ratio);
  }, [book.slug, chapter.id, recordProgress]);

  useEffect(() => {
    document.title = `${chapter.title} — ${book.title}`;
    return () => {
      document.title = SITE_DISPLAY_NAME;
    };
  }, [book.title, chapter.title]);

  // Arrival: hash → resume → top. Once per loaded chapter.
  const placedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || placedFor.current === chapter.id) return;
    placedFor.current = chapter.id;
    const hash = decodeURIComponent(location.hash.slice(1));
    const target = hash ? document.getElementById(hash) : null;
    const stored = readPosition(book.slug);
    let cancelled = false;
    if (target) {
      window.scrollTo({ top: Math.max(0, docTop(target)) });
    } else if (resume && stored?.chapterId === chapter.id) {
      const top = restoreTarget(stored, articleRef.current);
      window.scrollTo({ top });
      // A web font (Noto Serif JP) arriving after this reflows the page;
      // re-place once fonts settle, unless the reader has moved since.
      document.fonts?.ready.then(() => {
        if (!cancelled && Math.abs(window.scrollY - top) < 2) window.scrollTo({ top: restoreTarget(stored, articleRef.current) });
      });
    } else {
      window.scrollTo({ top: 0 });
    }
    // Opening a chapter is itself a position: 続きから読む comes back here.
    const frame = window.requestAnimationFrame(savePosition);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
    // location.hash / resume are read at arrival only, by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, chapter.id]);

  // Reading: throttled position writes, flushed when the page is left.
  useEffect(() => {
    if (!ready) return;
    let timer = 0;
    let last = 0;
    const flush = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
      last = Date.now();
      savePosition();
    };
    const onScroll = () => {
      if (timer) return;
      timer = window.setTimeout(flush, Math.max(0, SAVE_THROTTLE_MS - (Date.now() - last)));
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      if (timer) window.clearTimeout(timer);
    };
  }, [ready, savePosition]);

  // The footer in view = the chapter is read.
  useEffect(() => {
    const el = footerRef.current;
    if (!ready || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) recordProgress(1);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ready, recordProgress]);

  // ← / →: previous / next chapter, unless the reader is typing or using
  // a modified shortcut (browser back is Alt+←).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // The target is an Element when something has focus, but can be the
      // window or document itself (a synthetic or unfocused keydown).
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select, [contenteditable]'))) return;
      const to = e.key === 'ArrowLeft' ? prev : next;
      if (!to) return;
      e.preventDefault();
      navigate(chapterPath(book.slug, to.id));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [book.slug, prev, next, navigate]);

  return (
    <BookShell
      book={book}
      chapters={chapters}
      current={chapter}
      settings={settings}
      onSettingsChange={onSettingsChange}
      progress={progress}
    >
      <article ref={articleRef} className="book-body" aria-busy={!ready && !body.error}>
        {body.error ? (
          <BookErrorCard title={`章を読み込めません — ${chapter.id}`} detail={body.error} />
        ) : markdown !== null ? (
          <BookMarkdown book={book} markdown={markdown} kicker={chapter.kicker} />
        ) : (
          <div className="book-loading" aria-label="読み込み中">
            <p className="book-chapter-kicker">{chapter.kicker}</p>
            <p className="book-loading-title">{chapter.title}</p>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <span key={i} className="book-loading-line" aria-hidden />
            ))}
          </div>
        )}
      </article>

      {ready && (
        <footer ref={footerRef} className="book-footer">
          <nav className="book-pager" aria-label="前後の章">
            {prev ? (
              <Link to={chapterPath(book.slug, prev.id)} className="book-pager-card is-prev" rel="prev">
                <span className="book-pager-dir">← 前の章</span>
                <span className="book-pager-kicker">{prev.kicker}</span>
                <span className="book-pager-title">{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link to={chapterPath(book.slug, next.id)} className="book-pager-card is-next" rel="next">
                <span className="book-pager-dir">次の章 →</span>
                <span className="book-pager-kicker">{next.kicker}</span>
                <span className="book-pager-title">{next.title}</span>
              </Link>
            ) : (
              <span />
            )}
          </nav>
          <Link to={bookPath(book.slug)} className="book-footer-toc">
            目次へ
          </Link>
        </footer>
      )}
    </BookShell>
  );
}
