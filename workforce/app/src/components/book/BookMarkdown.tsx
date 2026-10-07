// One chapter's Markdown, rendered for reading (book-content-contract v1).
//
// GFM, no raw HTML (no rehype-raw: the contract's fenced blocks are the
// only extension). Headings h1–h4 get `h-<n>` ids in document order from a
// tiny rehype pass — the counter restarts with every parse, so the ids are
// a pure function of the Markdown and a stored reading anchor survives a
// reload. Doing it on the tree rather than in a render-time closure keeps
// the component map stable (memoised), so a re-render never remounts the
// body or its figures.

import { memo, useMemo, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { BookMeta } from '../../lib/books';
import { BookLink, ConnectAside, FigureBlock, NoteBlock, QuoteCard } from './blocks';

/** Minimal hast shape — enough to walk the tree without a types package. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const HEADING = /^h[1-4]$/;

/** rehype plugin: number h1–h4 as `h-1`, `h-2`, … in document order. */
export function rehypeHeadingIds() {
  return (tree: HastNode) => {
    let n = 0;
    const walk = (node: HastNode) => {
      if (node.type === 'element' && node.tagName && HEADING.test(node.tagName)) {
        n += 1;
        node.properties = { ...(node.properties ?? {}), id: `h-${n}` };
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

/** `<pre><code class="language-x">…</code></pre>` → { lang, text }. */
function fencedBlock(children: ReactNode): { lang: string; text: string } | null {
  const child = Array.isArray(children) ? children[0] : children;
  if (!child || typeof child !== 'object' || !('props' in child)) return null;
  const { className, children: source } = child.props as { className?: string; children?: ReactNode };
  const m = /\blanguage-([\w-]+)/.exec(className ?? '');
  if (!m) return null;
  return { lang: m[1], text: String(source ?? '') };
}

/** A paragraph whose only content is one image: the figure stands alone
 *  (a <figure> inside a <p> is invalid HTML). */
function isSoleImage(node: HastNode | undefined): boolean {
  const kids = (node?.children ?? []).filter(k => !(k.type === 'text' && !(k.value ?? '').trim()));
  return kids.length === 1 && kids[0].type === 'element' && kids[0].tagName === 'img';
}

type WithNode<T extends keyof JSX.IntrinsicElements> = ComponentProps<T> & { node?: unknown };

function makeComponents(book: BookMeta, kicker: string | undefined): Components {
  return {
    h1({ node: _node, children, id, ...rest }: WithNode<'h1'>) {
      // The first H1 is the chapter title: the manifest's kicker sits above it.
      if (id !== 'h-1') return <h1 id={id} {...rest}>{children}</h1>;
      return (
        <header className="book-chapter-head">
          {kicker && <p className="book-chapter-kicker">{kicker}</p>}
          <h1 id={id} {...rest}>
            {children}
          </h1>
        </header>
      );
    },
    pre({ node: _node, children, ...rest }: WithNode<'pre'>) {
      const fence = fencedBlock(children);
      if (fence?.lang === 'quote') return <QuoteCard text={fence.text} />;
      if (fence?.lang === 'connect') return <ConnectAside text={fence.text} />;
      if (fence?.lang === 'note') return <NoteBlock text={fence.text} />;
      return <pre {...rest}>{children}</pre>;
    },
    p({ node, children, ...rest }: WithNode<'p'>) {
      if (isSoleImage(node as HastNode | undefined)) return <>{children}</>;
      return <p {...rest}>{children}</p>;
    },
    img({ node: _node, src, alt, ...rest }: WithNode<'img'>) {
      if (src && /\.svg$/i.test(src)) return <FigureBlock book={book} src={src} caption={alt ?? ''} />;
      return <img src={src} alt={alt ?? ''} loading="lazy" {...rest} />;
    },
    table({ node: _node, children, ...rest }: WithNode<'table'>) {
      // Tables scroll sideways inside the measure instead of widening the page.
      return (
        <div className="book-table">
          <table {...rest}>{children}</table>
        </div>
      );
    },
    a: BookLink,
  };
}

const REMARK = [remarkGfm];
const REHYPE = [rehypeHeadingIds];

interface Props {
  book: BookMeta;
  markdown: string;
  /** The chapter's manifest kicker, shown above the H1. */
  kicker?: string;
}

function BookMarkdown({ book, markdown, kicker }: Props) {
  const components = useMemo(() => makeComponents(book, kicker), [book, kicker]);
  return (
    <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={components}>
      {markdown}
    </ReactMarkdown>
  );
}

export default memo(BookMarkdown);
