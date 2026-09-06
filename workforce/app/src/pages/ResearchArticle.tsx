// One research article, in the console's reading surface. Public.
//
// Body + frontmatter come from the reader site's export (lib/research.ts),
// in the reader's edition with a visible fallback to Japanese when no EN
// child page exists yet (ADR-0005). Cross-links follow ADR-0002: an
// analysis lists the sources it drew on, each with its explanation when
// one was written; an explanation lists the analyses that used it. The
// canonical URL for every article stays on kohuehara.xyz while both
// surfaces publish, and the page says so.

import { useEffect, useMemo, type ComponentProps } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import PublicShell from '../components/PublicShell';
import MermaidBlock from '../components/MermaidBlock';
import AuthorByline from '../components/research/AuthorByline';
import LanguageToggle from '../components/research/LanguageToggle';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import { SITE_DISPLAY_NAME } from '../config/site';
import { extractMermaidSource } from '../lib/reports';
import { useAsync } from '../lib/useAsync';
import { useResearchLanguage } from '../lib/useResearchLanguage';
import {
  buildSourceIndex,
  canonicalArticleUrl,
  displayTag,
  fetchResearchBody,
  fetchResearchManifest,
  hostnameOf,
  inferType,
  isResearchType,
  localizedTitle,
  lookupSource,
  parseAuthorSlugs,
  parseSourceUrls,
  researchPath,
  resolveCorpusUrl,
  tagsOf,
  type ResearchArticleMeta,
  type ResearchLanguage,
  type ResearchType,
} from '../lib/research';

const TYPE_LABEL: Record<ResearchType, string> = {
  analysis: 'Analysis',
  explanation: 'Explanation',
};

// ```mermaid fences render as figures; images written for the reader
// site's origin are re-rooted onto the corpus (resolveCorpusUrl); outbound
// links open in a new tab so the reader keeps their place.
const markdownComponents: Components = {
  pre({ node: _node, children, ...rest }: ComponentProps<'pre'> & { node?: unknown }) {
    const source = extractMermaidSource(children);
    if (source !== null) return <MermaidBlock code={source} />;
    return <pre {...rest}>{children}</pre>;
  },
  img({ node: _node, src, alt, ...rest }: ComponentProps<'img'> & { node?: unknown }) {
    return <img src={src ? resolveCorpusUrl(src) : undefined} alt={alt ?? ''} loading="lazy" {...rest} />;
  },
  a({ node: _node, href, children, ...rest }: ComponentProps<'a'> & { node?: unknown }) {
    const external = /^https?:\/\//i.test(href ?? '');
    return (
      <a href={href} {...rest} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  },
};

/** The exporter's `abstract` is the body's opening text; only render it
 *  as a lead when it is not simply the first paragraph again. */
function plain(text: string): string {
  return text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
}
function isLeadDistinct(abstract: string | undefined, body: string): boolean {
  if (!abstract) return false;
  const head = plain(abstract).slice(0, 48);
  return head.length > 0 && !plain(body).startsWith(head);
}

function ArticleLink({ article, lang }: { article: ResearchArticleMeta; lang: ResearchLanguage }) {
  return (
    <Link to={researchPath(article.slug)} className="block group">
      <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
        {TYPE_LABEL[inferType(article)]} · {article.date}
      </span>
      <span className="block mt-0.5 font-headline font-semibold text-[15px] leading-snug text-wf-on-surface group-hover:text-wf-primary">
        {localizedTitle(article, lang)}
      </span>
    </Link>
  );
}

export default function ResearchArticle() {
  const { slug = '' } = useParams<{ slug: string }>();
  const lang = useResearchLanguage();
  const body = useAsync(() => fetchResearchBody(slug, lang), [slug, lang]);
  const manifest = useAsync(() => fetchResearchManifest(), []);

  const row = useMemo(() => manifest.data?.find(a => a.slug === slug), [manifest.data, slug]);
  const index = useMemo(() => buildSourceIndex(manifest.data ?? []), [manifest.data]);

  // Frontmatter is authoritative for the served edition (it IS that
  // edition's title); the manifest fills in what the body lacks (tags,
  // EN availability, author, Spotify).
  const meta = body.data?.meta;
  const type = inferType({ type: isResearchType(meta?.type) ? meta.type : row?.type });
  const title = meta?.title ?? (row ? localizedTitle(row, lang) : '');
  const tags = tagsOf({
    tags: row?.tags ?? meta?.tags,
    categoriesMulti: row?.categoriesMulti,
    category: meta?.category ?? row?.category,
  });
  const authors = parseAuthorSlugs(meta?.author ?? row?.author);
  const date = meta?.date ?? row?.date;
  const spotifyUrl = meta?.spotifyUrl ?? row?.spotifyUrl;
  const sourceUrls = parseSourceUrls(meta?.sourceUrls ?? row?.sourceUrls);
  const fellBackToJa = lang === 'en' && body.data?.servedLanguage === 'ja';
  const showLead = body.data ? isLeadDistinct(meta?.abstract, body.data.content) : false;
  const heroImage = meta?.image ?? row?.image;

  useEffect(() => {
    document.title = title ? `${title} — ${SITE_DISPLAY_NAME} Research` : `${SITE_DISPLAY_NAME} — Research`;
    return () => {
      document.title = SITE_DISPLAY_NAME;
    };
  }, [title]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [slug]);

  // Explanations reachable from this analysis (and analyses drawing on
  // this explanation) — the ADR-0002 back-drawer, both directions.
  const sources = sourceUrls.map(url => ({ url, entry: lookupSource(index, url) }));
  const usedBy =
    type === 'explanation' && sourceUrls.length > 0
      ? (lookupSource(index, sourceUrls[0])?.analyses ?? []).filter(a => a.slug !== slug)
      : [];

  const chip =
    'font-wfmono text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-wf-lg border border-wf-outline-variant bg-wf-surface-container text-wf-on-surface-variant hover:border-wf-primary hover:text-wf-primary transition-colors';
  const card = 'border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4';
  const kicker = 'font-wfmono text-[11px] font-semibold uppercase tracking-[0.14em] text-wf-on-surface-variant';

  return (
    <PublicShell>
      <div className="max-w-[780px] mx-auto">
        <nav className="pt-8 font-wfmono text-[11px] text-wf-on-surface-variant flex items-center justify-between gap-4">
          <span>
            <Link to="/research" className="hover:text-wf-on-surface underline">
              Research
            </Link>
            <span className="mx-1.5">/</span>
            <span>{TYPE_LABEL[type]}</span>
          </span>
          <LanguageToggle value={lang} />
        </nav>

        {body.error && (
          <div className="mt-10 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-6">
            <p className="font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-tertiary">Not found</p>
            <h1 className="mt-2 font-headline font-bold text-2xl">This article is not in the corpus.</h1>
            <p className="mt-2 text-sm text-wf-on-surface-variant">
              {body.error}. The slug may be wrong, or the reader site&rsquo;s export has not published it yet.
            </p>
            <Link
              to="/research"
              className="inline-block mt-5 font-wfmono text-[11px] uppercase tracking-[0.14em] hover:text-wf-primary underline"
            >
              ← Back to Research
            </Link>
          </div>
        )}

        {!body.error && (
          <header className="mt-6 pb-8 border-b border-wf-outline-variant">
            {tags.length > 0 && (
              <ul className="flex flex-wrap gap-1.5 mb-5">
                {tags.map(tag => (
                  <li key={tag}>
                    <Link to={`/research?tag=${encodeURIComponent(tag)}`} className={chip}>
                      {displayTag(tag)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {body.loading && !title ? (
              <>
                <Skeleton className="h-9 w-4/5" />
                <Skeleton className="mt-3 h-9 w-3/5" />
              </>
            ) : (
              <h1 className="font-headline font-bold text-[clamp(26px,4vw,40px)] leading-[1.15] tracking-[-0.02em] text-wf-on-surface">
                {title}
              </h1>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
              {authors.length > 0 && <AuthorByline slugs={authors} />}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                {date && <span>{date}</span>}
                {type === 'explanation' && <span className="text-wf-tertiary">Explanation · 解説</span>}
                {spotifyUrl && (
                  <a href={spotifyUrl} target="_blank" rel="noopener noreferrer" className="hover:text-wf-primary">
                    Spotify ↗
                  </a>
                )}
              </div>
            </div>
            {showLead && (
              <p className="mt-6 text-[17px] leading-relaxed text-wf-on-surface-variant border-l-2 border-wf-tertiary pl-5">
                {plain(meta?.abstract ?? '')}
              </p>
            )}
          </header>
        )}

        {fellBackToJa && (
          <div className="mt-8 border-l-2 border-wf-outline-variant pl-5 py-1">
            <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
              No English edition yet
            </p>
            <p className="mt-1 text-sm text-wf-on-surface-variant">
              This article has not been translated. The Japanese edition is shown below; the English one
              appears here automatically once it is published.
            </p>
          </div>
        )}

        {body.loading && (
          <div className="py-10" aria-busy>
            <SkeletonText lines={6} />
            <SkeletonText lines={5} className="mt-8" />
          </div>
        )}

        {body.data && (
          <article className="research-prose py-10" lang={body.data.servedLanguage}>
            {heroImage && (
              <figure className="mb-8">
                <img src={resolveCorpusUrl(heroImage)} alt="" className="w-full" />
              </figure>
            )}
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {body.data.content}
            </ReactMarkdown>
          </article>
        )}

        {body.data && type === 'analysis' && sources.length > 0 && (
          <section className="border-t border-wf-outline-variant pt-8 pb-4">
            <h2 className={kicker}>Sources used</h2>
            <p className="mt-1 text-[13px] text-wf-on-surface-variant">
              Primary sources this analysis draws on; each links to the network&rsquo;s own explanation of
              it where one was written.
            </p>
            <ol className="mt-4 space-y-3">
              {sources.map(({ url, entry }, i) => (
                <li key={url} className={`${card} flex gap-4`}>
                  <span className="font-wfmono text-[11px] text-wf-on-surface-variant pt-0.5 w-5 shrink-0">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    {entry?.explanation ? (
                      <ArticleLink article={entry.explanation} lang={lang} />
                    ) : (
                      <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                        No explanation yet
                      </span>
                    )}
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block font-wfmono text-[12px] text-wf-on-surface-variant hover:text-wf-primary truncate"
                    >
                      {hostnameOf(url)} ↗
                    </a>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {body.data && type === 'explanation' && (
          <section className="border-t border-wf-outline-variant pt-8 pb-4">
            <h2 className={kicker}>{usedBy.length > 0 ? 'Analyses using this source' : 'Original source'}</h2>
            {sourceUrls[0] && (
              <a
                href={sourceUrls[0]}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-2 font-wfmono text-[12px] text-wf-on-surface-variant hover:text-wf-primary"
              >
                {hostnameOf(sourceUrls[0])} ↗
              </a>
            )}
            {usedBy.length > 0 && (
              <ul className="mt-4 space-y-3">
                {usedBy.map(a => (
                  <li key={a.slug} className={card}>
                    <ArticleLink article={a} lang={lang} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {body.data && (
          <footer className="border-t border-wf-outline-variant py-8 mb-8 flex flex-wrap items-center justify-between gap-4 font-wfmono text-[11px] uppercase tracking-[0.14em]">
            <Link to="/research" className="text-wf-on-surface hover:text-wf-primary">
              ← All research
            </Link>
            <a
              href={canonicalArticleUrl(slug, lang)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-wf-on-surface-variant hover:text-wf-primary"
            >
              Reader edition on kohuehara.xyz ↗
            </a>
          </footer>
        )}
      </div>
    </PublicShell>
  );
}
