// A book's cover (/books/:slug): title, what it is, who wrote it, where
// the reader stopped, and the whole table of contents with each chapter's
// reading time and read state. Public, in PublicShell.
//
// Reading times are computed from the bodies (contract: characters ÷ 600
// per minute), not stored in the manifest, so the cover fetches every
// chapter chunk after first paint. They are the same chunks the reader
// opens next (lib/books.ts memoises them), so the cost is paid once; the
// table renders immediately and the minutes fill in.

import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import PublicShell from '../components/PublicShell';
import ReadMark from '../components/book/ReadMark';
import { CARD, H1, KICKER, KICKER_ACCENT, LEDE, PILL_PRIMARY, TEXT_LINK } from '../components/public/styles';
import { SITE_DISPLAY_NAME } from '../config/site';
import { useAsync } from '../lib/useAsync';
import {
  chapterPath,
  estimateMinutes,
  findBook,
  flattenChapters,
  loadChapter,
  type BookMeta,
} from '../lib/books';
import { readPosition, readProgress } from '../lib/bookPosition';

/** Minutes per chapter id; a chapter that fails to load maps to an Error
 *  so the row can say so (C-4) instead of hiding the gap. */
async function chapterMinutes(book: BookMeta): Promise<Record<string, number | Error>> {
  const flat = flattenChapters(book);
  const settled = await Promise.allSettled(flat.map(c => loadChapter(book, c)));
  const out: Record<string, number | Error> = {};
  settled.forEach((r, i) => {
    out[flat[i].id] = r.status === 'fulfilled' ? estimateMinutes(r.value) : r.reason instanceof Error ? r.reason : new Error(String(r.reason));
  });
  return out;
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

export default function Book() {
  const { slug = '' } = useParams<{ slug: string }>();
  const book = findBook(slug);

  useEffect(() => {
    if (!book) return;
    document.title = `${book.title} — ${SITE_DISPLAY_NAME}`;
    return () => {
      document.title = SITE_DISPLAY_NAME;
    };
  }, [book]);

  if (!book) {
    return (
      <PublicShell>
        <nav className={`pt-8 ${KICKER}`} aria-label="Breadcrumb">
          <Link to="/books" className="hover:text-wf-on-surface underline underline-offset-2">
            Books
          </Link>
        </nav>
        <div className={`mt-10 ${CARD} p-6`}>
          <p className={KICKER_ACCENT}>Not found</p>
          <h1 className="mt-2 font-headline font-bold text-2xl">There is no book called “{slug}”.</h1>
          <Link to="/books" className={`inline-block mt-5 ${TEXT_LINK} underline underline-offset-2`}>
            ← All books
          </Link>
        </div>
      </PublicShell>
    );
  }
  return <Cover book={book} />;
}

function Cover({ book }: { book: BookMeta }) {
  const flat = useMemo(() => flattenChapters(book), [book]);
  // Read once per visit: the cover is not open while the reader reads.
  const position = useMemo(() => readPosition(book.slug), [book.slug]);
  const progress = useMemo(() => readProgress(book.slug), [book.slug]);
  const minutes = useAsync(() => chapterMinutes(book), [book.slug]);

  const resumeChapter = position ? flat.find(c => c.id === position.chapterId) : undefined;
  const total = minutes.data
    ? Object.values(minutes.data).reduce<number>((sum, m) => sum + (typeof m === 'number' ? m : 0), 0)
    : null;

  return (
    <PublicShell>
      <div lang={book.lang}>
        <nav className={`pt-8 ${KICKER} flex items-center gap-1.5`} aria-label="Breadcrumb">
          <Link to="/books" className="hover:text-wf-on-surface underline underline-offset-2">
            Books
          </Link>
          <span aria-hidden>/</span>
          <span>{book.title}</span>
        </nav>

        <section className="pt-10 pb-10 sm:pt-14">
          <p className={KICKER_ACCENT}>{book.kicker}</p>
          <h1 className={`${H1} mt-4`}>{book.title}</h1>
          <p className="mt-4 font-headline font-semibold text-[clamp(17px,2.2vw,22px)] leading-snug text-wf-on-surface max-w-[40ch]">
            {book.subtitle}
          </p>
          <p className={`${LEDE} mt-6`}>{book.description}</p>
          <p className="mt-5 font-wfmono text-[12px] tracking-[0.04em] text-wf-on-surface-variant">
            by {book.authors.join(' · ')}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
            {resumeChapter && position ? (
              <Link to={`${chapterPath(book.slug, resumeChapter.id)}?resume=1`} className={PILL_PRIMARY}>
                続きから読む
              </Link>
            ) : (
              <Link to={chapterPath(book.slug, flat[0].id)} className={PILL_PRIMARY}>
                はじめから読む
              </Link>
            )}
            {resumeChapter && position && (
              <span className="text-[14px] text-wf-on-surface-variant">
                {resumeChapter.title}
                <span className="font-wfmono text-[12px] ml-2">{Math.round(position.ratio * 100)}%</span>
              </span>
            )}
          </div>
        </section>

        <section className="pb-6" aria-labelledby="book-contents">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="book-contents" className={KICKER}>
              目次
            </h2>
            <p className="font-wfmono text-[11px] tracking-[0.08em] text-wf-on-surface-variant">
              {flat.length}章 · {total === null ? '読了時間を計算中' : `約${formatMinutes(total)}`}
            </p>
          </div>

          {book.parts.map(part => (
            <div key={part.id} className="mt-8">
              <h3 className="font-headline font-bold text-[17px] text-wf-on-surface">{part.title}</h3>
              <ol className="mt-3 grid gap-2">
                {part.chapters.map(ch => {
                  const m = minutes.data?.[ch.id];
                  return (
                    <li key={ch.id}>
                      <Link
                        to={chapterPath(book.slug, ch.id)}
                        className={`${CARD} hover:border-wf-primary transition-colors flex items-center gap-4 px-5 py-4`}
                      >
                        <span className="w-[5.5em] shrink-0 font-wfmono text-[11px] tracking-[0.08em] text-wf-primary">{ch.kicker}</span>
                        <span className="flex-1 min-w-0 font-headline font-semibold text-[15.5px] leading-snug text-wf-on-surface">
                          {ch.title}
                        </span>
                        <span className="shrink-0 font-wfmono text-[11px] text-wf-on-surface-variant">
                          {m instanceof Error ? (
                            <span role="alert" className="text-wf-throwing" title={m.message}>
                              読み込み失敗
                            </span>
                          ) : typeof m === 'number' ? (
                            `${m}分`
                          ) : (
                            '…'
                          )}
                        </span>
                        <ReadMark ratio={progress[ch.id]} className="shrink-0 text-wf-primary" />
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}

          <p className="mt-8 font-wfmono text-[11px] tracking-[0.08em] text-wf-on-surface-variant">
            v{book.version} · {book.updated} · 読書位置はこの端末にだけ保存されます
          </p>
          <Link to="/books" className={`inline-block mt-6 ${TEXT_LINK}`}>
            ← All books
          </Link>
        </section>
      </div>
    </PublicShell>
  );
}
