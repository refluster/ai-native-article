// The reading view's own chrome (/books/:slug/:chapterId) — deliberately
// not PublicShell. Hours of reading want almost nothing on screen: a 48px
// top bar (back to the cover, book · chapter, 目次, Aa) that slides away
// while the reader scrolls down and returns the moment they scroll up, a
// 2px progress line above it that never hides, and the page in the
// reader's chosen size, theme and family.
//
// The 目次 drawer slides in over the page on phones and docks as a side
// panel from 1024px, where the measure moves over to make room. Reduced
// motion: the bar and drawer show and hide without animating (index.css).
//
// The theme is mirrored onto <html data-book-theme> so the canvas past the
// page (iOS overscroll, a short chapter) is the page colour, not the
// console's Cool Mist.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { bookPath, chapterPath, type BookMeta, type FlatChapter } from '../../lib/books';
import type { BookFamily, BookSettings, BookSize, BookTheme } from '../../lib/bookPosition';
import ReadMark from './ReadMark';

const SIZES: { value: BookSize; label: string }[] = [
  { value: 's', label: 'S' },
  { value: 'm', label: 'M' },
  { value: 'l', label: 'L' },
];
const THEMES: { value: BookTheme; label: string }[] = [
  { value: 'paper', label: '紙' },
  { value: 'sepia', label: 'セピア' },
  { value: 'night', label: '夜' },
];
const FAMILIES: { value: BookFamily; label: string }[] = [
  { value: 'serif', label: '明朝' },
  { value: 'sans', label: 'ゴシック' },
];

/** Scrolled less than this from the top, the bar always shows. */
const BAR_REVEAL_ZONE = 64;
/** Scroll deltas smaller than this are jitter, not intent. */
const BAR_JITTER = 6;

function isDesktop(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches;
}

interface Props {
  book: BookMeta;
  chapters: readonly FlatChapter[];
  current: FlatChapter;
  settings: BookSettings;
  onSettingsChange: (next: BookSettings) => void;
  /** Read ratio per chapter id (lib/bookPosition readProgress). */
  progress: Readonly<Record<string, number>>;
  children: ReactNode;
}

function Choice<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="book-settings-group">
      <legend>{legend}</legend>
      <div className="book-settings-options">
        {options.map(o => (
          <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export default function BookShell({ book, chapters, current, settings, onSettingsChange, progress, children }: Props) {
  const [barHidden, setBarHidden] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const tocButtonRef = useRef<HTMLButtonElement>(null);
  const tocCloseRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  // Progress line + bar visibility. One rAF per frame at most; the line is
  // written straight to the DOM (a transform) so scrolling never
  // re-renders the chapter.
  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, y / max)) : 1;
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${ratio})`;
      if (y < BAR_REVEAL_ZONE) {
        setBarHidden(false);
        lastY = y;
      } else if (Math.abs(y - lastY) > BAR_JITTER) {
        setBarHidden(y > lastY);
        lastY = y;
      }
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Body colour beyond the page.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.bookTheme = settings.theme;
    return () => {
      delete root.dataset.bookTheme;
    };
  }, [settings.theme]);

  // Escape closes whichever panel is open and hands focus back to its button.
  useEffect(() => {
    if (!tocOpen && !settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (settingsOpen) {
        setSettingsOpen(false);
        settingsButtonRef.current?.focus();
      } else if (tocOpen) {
        setTocOpen(false);
        tocButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tocOpen, settingsOpen]);

  // A click outside the settings popover closes it.
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (settingsRef.current?.contains(t) || settingsButtonRef.current?.contains(t)) return;
      setSettingsOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [settingsOpen]);

  // Opening the drawer moves focus into it (phones: it covers the page).
  useEffect(() => {
    if (tocOpen && !isDesktop()) tocCloseRef.current?.focus();
  }, [tocOpen]);

  // Leaving a chapter from the drawer closes it on phones; the docked
  // desktop panel stays, so the reader can keep browsing the contents.
  useEffect(() => {
    if (!isDesktop()) setTocOpen(false);
  }, [current.id]);

  const hidden = barHidden && !tocOpen && !settingsOpen;
  const rootClass = [
    'book-root',
    `book-theme-${settings.theme}`,
    `book-size-${settings.size}`,
    `book-family-${settings.family}`,
    tocOpen ? 'is-toc-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} lang={book.lang}>
      <div className="book-progress" aria-hidden>
        <div ref={progressRef} className="book-progress-fill" />
      </div>

      <header className={`book-topbar${hidden ? ' is-hidden' : ''}`} onFocus={() => setBarHidden(false)}>
        <Link to={bookPath(book.slug)} className="book-topbar-back" aria-label={`${book.title} — 表紙へ戻る`}>
          <span aria-hidden>←</span>
        </Link>
        <p className="book-topbar-title">
          <span className="book-topbar-book">{book.title}</span>
          <span className="book-topbar-kicker">{current.kicker}</span>
        </p>
        <button
          ref={tocButtonRef}
          type="button"
          className="book-topbar-button"
          aria-expanded={tocOpen}
          aria-controls="book-toc"
          onClick={() => {
            setSettingsOpen(false);
            setTocOpen(o => !o);
          }}
        >
          目次
        </button>
        <button
          ref={settingsButtonRef}
          type="button"
          className="book-topbar-button"
          aria-expanded={settingsOpen}
          aria-controls="book-settings"
          aria-label="表示設定"
          onClick={() => setSettingsOpen(o => !o)}
        >
          Aa
        </button>
      </header>

      {settingsOpen && (
        <div ref={settingsRef} id="book-settings" className="book-settings" role="dialog" aria-label="表示設定">
          <Choice legend="文字サイズ" options={SIZES} value={settings.size} onChange={size => onSettingsChange({ ...settings, size })} />
          <Choice legend="テーマ" options={THEMES} value={settings.theme} onChange={theme => onSettingsChange({ ...settings, theme })} />
          <Choice legend="書体" options={FAMILIES} value={settings.family} onChange={family => onSettingsChange({ ...settings, family })} />
        </div>
      )}

      {tocOpen && <div className="book-toc-backdrop" aria-hidden onClick={() => setTocOpen(false)} />}
      <nav id="book-toc" className={`book-toc${tocOpen ? ' is-open' : ''}`} aria-label="目次" aria-hidden={!tocOpen}>
        <div className="book-toc-head">
          <Link to={bookPath(book.slug)} className="book-toc-book" tabIndex={tocOpen ? undefined : -1}>
            {book.title}
          </Link>
          <button
            ref={tocCloseRef}
            type="button"
            className="book-topbar-button"
            tabIndex={tocOpen ? undefined : -1}
            onClick={() => {
              setTocOpen(false);
              tocButtonRef.current?.focus();
            }}
          >
            閉じる
          </button>
        </div>
        {book.parts.map(part => (
          <section key={part.id} className="book-toc-part">
            <p className="book-toc-part-title">{part.title}</p>
            <ol>
              {chapters
                .filter(c => c.part.id === part.id)
                .map(c => (
                  <li key={c.id}>
                    <Link
                      to={chapterPath(book.slug, c.id)}
                      className="book-toc-item"
                      aria-current={c.id === current.id ? 'page' : undefined}
                      tabIndex={tocOpen ? undefined : -1}
                    >
                      <span className="book-toc-kicker">{c.kicker}</span>
                      <span className="book-toc-title">{c.title}</span>
                      <ReadMark ratio={progress[c.id]} className="book-toc-mark" />
                    </Link>
                  </li>
                ))}
            </ol>
          </section>
        ))}
      </nav>

      <main className="book-main">{children}</main>
    </div>
  );
}
