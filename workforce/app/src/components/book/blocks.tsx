// The web books' block vocabulary (book-content-contract v1), rendered:
// QuoteCard (```quote), ConnectAside (```connect), NoteBlock (```note),
// FigureBlock (an `.svg` image) and the error card every one of them falls
// back to. Styling is the `.book-*` block at the end of index.css, painted
// with the reader's theme variables so paper / sepia / night all hold.

import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseConnectBlock, parseNoteBlock, parseQuoteBlock } from '../../lib/bookBlocks';
import { loadFigure, peekFigure, type BookMeta } from '../../lib/books';

/** A visible, in-place error (C-4): a malformed block or a missing figure
 *  says what is wrong and where, and the chapter keeps rendering around it. */
export function BookErrorCard({ title, detail, raw }: { title: string; detail: string; raw?: string }) {
  return (
    <div role="alert" className="book-error">
      <p className="book-error-kicker">{title}</p>
      <p className="book-error-detail">{detail}</p>
      {raw && <pre className="book-error-raw">{raw}</pre>}
    </div>
  );
}

/** Book links: outbound opens a tab (the reader keeps their place),
 *  `/books/…` stays in the SPA, everything else (`#h-3`) is a plain anchor. */
export function BookLink({ node: _node, href, children, ...rest }: ComponentProps<'a'> & { node?: unknown }) {
  if (href && /^https?:\/\//i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  if (href && href.startsWith('/books/')) {
    return (
      <Link to={href} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

// The body of a connect / note block is Markdown, but only the prose
// subset: a heading or a table inside an aside would break the chapter's
// outline (and its h-<n> anchors), so anything else is unwrapped to text.
const INLINE_ELEMENTS = ['p', 'em', 'strong', 'del', 'code', 'a', 'ul', 'ol', 'li', 'br'];
const INLINE_COMPONENTS: Components = { a: BookLink };

function InlineMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={INLINE_ELEMENTS}
      unwrapDisallowed
      components={INLINE_COMPONENTS}
    >
      {children}
    </ReactMarkdown>
  );
}

export function QuoteCard({ text }: { text: string }) {
  const parsed = parseQuoteBlock(text);
  if (!parsed.ok) return <BookErrorCard title="引用ブロックの形式エラー" detail={parsed.error} raw={text.trim()} />;
  const q = parsed.value;
  return (
    <figure className="book-quote">
      <blockquote className="book-quote-original">{q.original}</blockquote>
      <p className="book-quote-kundoku">{q.kundoku}</p>
      {/* 出典 sits between 訓読 and 訳 (the reading order), so it is a
          <cite> in a paragraph, not a <figcaption> (first/last child only). */}
      <p className="book-quote-meta">
        <cite className="book-quote-source">{q.source}</cite>
      </p>
      {q.translation && <p className="book-quote-translation">{q.translation}</p>}
    </figure>
  );
}

export function ConnectAside({ text }: { text: string }) {
  const parsed = parseConnectBlock(text);
  if (!parsed.ok) return <BookErrorCard title="接続ブロックの形式エラー" detail={parsed.error} raw={text.trim()} />;
  return (
    <aside className="book-connect" aria-label={`接続: ${parsed.value.title}`}>
      <p className="book-connect-kicker">接続</p>
      <p className="book-connect-title">{parsed.value.title}</p>
      <div className="book-connect-body">
        <InlineMarkdown>{parsed.value.body}</InlineMarkdown>
      </div>
    </aside>
  );
}

export function NoteBlock({ text }: { text: string }) {
  const parsed = parseNoteBlock(text);
  if (!parsed.ok) return <BookErrorCard title="注ブロックの形式エラー" detail={parsed.error} />;
  return (
    <aside className="book-note" role="note">
      <InlineMarkdown>{parsed.value}</InlineMarkdown>
    </aside>
  );
}

/**
 * An inline SVG figure. The SVG is repo-authored and bundled at build time
 * (lib/books.ts lazy glob) — the same trust argument as the documents in
 * pages/Doc.tsx — so injecting it is safe, and inlining (rather than an
 * <img>) is what lets it paint with the reader's theme variables.
 * A figure the chapter view preloaded renders on the first paint.
 */
export function FigureBlock({ book, src, caption }: { book: BookMeta; src: string; caption: ReactNode }) {
  const [state, setState] = useState<{ svg: string | null; error: string | null }>(() => ({
    svg: peekFigure(book, src),
    error: null,
  }));

  useEffect(() => {
    const cached = peekFigure(book, src);
    if (cached) {
      setState({ svg: cached, error: null });
      return;
    }
    let cancelled = false;
    setState({ svg: null, error: null });
    loadFigure(book, src).then(
      svg => {
        if (!cancelled) setState({ svg, error: null });
      },
      (err: unknown) => {
        if (!cancelled) setState({ svg: null, error: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [book, src]);

  if (state.error) return <BookErrorCard title="図を読み込めません" detail={state.error} />;
  return (
    <figure className="book-figure">
      {state.svg ? (
        <div className="book-figure-art" dangerouslySetInnerHTML={{ __html: state.svg }} />
      ) : (
        <div className="book-figure-art is-loading" aria-busy />
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
