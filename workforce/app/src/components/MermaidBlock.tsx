import { useEffect, useState } from 'react';
import type { Mermaid } from 'mermaid';

/**
 * Renders a ```mermaid fenced block from a report body as an inline figure.
 *
 * Ported from newsletter/app/src/components/article/MermaidBlock.tsx:
 * mermaid is ~1.5MB minified, so it is loaded on demand — report pages
 * without a figure never pay for it (Vite code-splits the dynamic import).
 * The workforce console keeps mermaid's `neutral` theme rather than the
 * newsletter's Precision Editorial token mapping; the console's own type
 * scale carries the page, and figures read as documents, not brand art.
 */

let mermaidPromise: Promise<Mermaid> | null = null;

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        // A parse error must surface as our own visible failure block, not
        // mermaid's injected "bomb" SVG.
        suppressErrorRendering: true,
        theme: 'neutral',
        fontFamily: 'inherit',
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let figureSeq = 0;

export default function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    loadMermaid()
      .then(mermaid => mermaid.render(`report-figure-${++figureSeq}`, code))
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch((err: unknown) => {
        // Fail loud: a broken figure renders as an explicit failure block
        // (with its source, so the author can fix the markdown), never as
        // silent whitespace.
        console.error('[MermaidBlock] render failed:', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) {
    return (
      <figure className="my-6 border border-wf-outline-variant bg-wf-surface-container-lo p-4">
        <span className="block mb-2 font-wfmono text-[10px] font-bold tracking-widest uppercase text-wf-throwing">
          Figure failed to render
        </span>
        <pre className="overflow-x-auto whitespace-pre-wrap font-wfmono text-xs text-wf-on-surface-variant">
          <code>{code}</code>
        </pre>
      </figure>
    );
  }

  if (svg === null) {
    return (
      <figure className="my-6 min-h-[8rem] flex items-center justify-center">
        <span className="font-wfmono text-[10px] font-bold tracking-widest uppercase text-wf-on-surface-variant animate-pulse">
          Rendering figure…
        </span>
      </figure>
    );
  }

  return <figure className="my-6 overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}
