import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { L1_REGISTER_URL, L1_SOURCES_URL, L1_TOKEN_KEY } from '../../lib/l1-capture'

/**
 * Capture — the only page on this site that accepts user input.
 *
 * It saves a URL into the L1 source library; the workforce article-level2 /
 * article-level3 cadences turn each captured URL into a 解説 article
 * (single-source explainer) and feed combinations into 分析 articles.
 *
 * Backend: the wf-l1-source-register Lambda (POST /l1/register, GET
 * /l1/sources) — the non-GAS replacement for the retired GAS L1_SAVE. The
 * write is **mechanical (no LLM)**: title/category are saved as entered, not
 * auto-extracted. Auth is a bearer token the operator enters once (kept in
 * localStorage, never baked into the bundle); the same token gates the page.
 */

/** A captured source row. Mirrors the GET /l1/sources wire shape. */
interface CapturedEntry {
  id?: string
  title: string
  sourceUrl: string
  category: string
  contentsSummary: string
  publicationDate: string
  notionUrl?: string
  createdAt?: string
}

interface CaptureStats {
  today: number
  last7: number
  streak: number
}

function computeStats(entries: CapturedEntry[]): CaptureStats {
  const dayKey = (d: Date) => d.toLocaleDateString('sv-SE')
  const byDay = new Map<string, number>()
  for (const e of entries) {
    if (!e.createdAt) continue
    const k = dayKey(new Date(e.createdAt))
    byDay.set(k, (byDay.get(k) ?? 0) + 1)
  }
  const now = new Date()
  const today = byDay.get(dayKey(now)) ?? 0
  let last7 = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    last7 += byDay.get(dayKey(d)) ?? 0
  }
  let streak = 0
  const start = today > 0 ? 0 : 1
  for (let i = start; ; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    if ((byDay.get(dayKey(d)) ?? 0) === 0) break
    streak++
  }
  return { today, last7, streak }
}

const CATEGORIES = [
  { code: 'A', label: 'AI Hyper-productivity' },
  { code: 'B', label: 'Role Blurring' },
  { code: 'C', label: 'New Roles / FDE' },
  { code: 'D', label: 'Big Tech Layoffs & AI Pivot' },
  { code: 'E', label: 'Rethinking SDLC' },
]

// iOS/Safari often drops the shared URL into `text` instead of `url`.
function extractUrl(params: URLSearchParams): string {
  const direct = params.get('url')?.trim()
  if (direct) return direct
  const text = params.get('text')?.trim() ?? ''
  const match = text.match(/https?:\/\/\S+/)
  return match ? match[0] : ''
}

// ── Token gate ───────────────────────────────────────────────────────────
// The entered value IS the bearer token (Secrets Manager
// wf/api/l1-source-write-token). We can't validate it client-side, so we store
// it and let the API 401 surface a wrong token (which re-locks the page).

function readToken(): string {
  try {
    return localStorage.getItem(L1_TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function TokenGate({ children }: { children: (token: string, onAuthFail: () => void) => React.ReactNode }) {
  const endpointMissing = !L1_REGISTER_URL
  const [token, setToken] = useState<string>(() => readToken())
  const [input, setInput] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const t = input.trim()
    if (!t) return
    try {
      localStorage.setItem(L1_TOKEN_KEY, t)
    } catch {
      /* private mode — session-only */
    }
    setToken(t)
    setInput('')
  }

  function onAuthFail() {
    try {
      localStorage.removeItem(L1_TOKEN_KEY)
    } catch {
      /* ignore */
    }
    setToken('')
  }

  if (endpointMissing) {
    return (
      <section className="min-h-[60vh] flex items-center justify-center px-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-3xl font-black tracking-tighter uppercase mb-3">Capture</h1>
          <div className="bg-error/10 border border-error text-error text-xs p-4">
            VITE_L1_CAPTURE_ENDPOINT is unset at build time — the capture endpoint
            is not configured, so this page can&rsquo;t save. Set it to the
            <code className="mx-1">/l1/register</code> URL and rebuild.
          </div>
        </div>
      </section>
    )
  }

  if (token) return <>{children(token, onAuthFail)}</>

  return (
    <section className="min-h-[60vh] flex items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        <h1 className="text-3xl font-black tracking-tighter uppercase mb-2">Capture</h1>
        <p className="text-[11px] text-on-surface-variant mb-8">
          This page is private. Enter the capture token to continue.
        </p>
        <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-2">
          Capture token
        </label>
        <input
          type="password"
          autoFocus
          value={input}
          onChange={e => setInput(e.target.value)}
          className="w-full bg-transparent border-b border-outline pb-3 text-base focus:outline-none focus:border-b-2 focus:border-primary"
        />
        <button
          type="submit"
          className="mt-6 w-full bg-primary text-on-primary px-6 py-3 text-xs font-bold tracking-widest uppercase hover:bg-primary-dim transition-colors"
        >
          Unlock
        </button>
      </form>
    </section>
  )
}

// ── Capture form ───────────────────────────────────────────────────────────

function CaptureBody({ token, onAuthFail }: { token: string; onAuthFail: () => void }) {
  const [entries, setEntries] = useState<CapturedEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const autoSubmitted = useRef(false)

  const authHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

  useEffect(() => {
    loadEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle incoming share-target payload: prefill + auto-submit once.
  useEffect(() => {
    if (autoSubmitted.current) return
    const shared = extractUrl(searchParams)
    if (!shared) return
    autoSubmitted.current = true
    setSourceUrl(shared)
    setSearchParams({}, { replace: true })
    void submit(shared)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams])

  async function loadEntries() {
    try {
      const response = await fetch(L1_SOURCES_URL, { headers: authHeaders })
      if (response.status === 401) {
        onAuthFail()
        return
      }
      const data = await response.json()
      if (data.ok) {
        const list: CapturedEntry[] = data.data || []
        list.sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return tb - ta
        })
        setEntries(list)
      }
    } catch (err) {
      console.error('Failed to load entries:', err)
    }
  }

  async function submit(url: string) {
    setLoading(true)
    setError('')
    try {
      const body: Record<string, string> = { url }
      if (title.trim()) body.title = title.trim()
      if (category) body.category = category
      const response = await fetch(L1_REGISTER_URL, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(body),
      })
      if (response.status === 401) {
        onAuthFail()
        return
      }
      const data = await response.json()
      if (data.ok) {
        setSourceUrl('')
        setTitle('')
        setCategory('')
        await loadEntries()
      } else {
        setError(data.error || 'Failed to capture article')
      }
    } catch (err) {
      setError(`Failed to save: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = sourceUrl.trim()
    if (!trimmed) {
      setError('Please enter a URL')
      return
    }
    await submit(trimmed)
  }

  return (
    <>
      <section className="w-full bg-surface">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-6 md:pt-16 pb-6 md:pb-16">
          <Link to="/" className="inline-block text-[10px] font-bold tracking-widest text-outline uppercase mb-4 md:mb-10 hover:text-tertiary transition-colors">
            ← INDEX
          </Link>
          <h1 className="text-3xl md:text-7xl font-black tracking-tighter leading-none mb-2 md:mb-6 uppercase">
            Capture
          </h1>
          <p className="hidden md:block text-xl text-on-surface-variant max-w-2xl leading-relaxed">
            気になった記事の URL を保存します。後ほど自動で 解説記事 と 分析記事 に変換され、サイト上で公開されます。
          </p>

          {(() => {
            const { today, last7, streak } = computeStats(entries)
            const Stat = ({ label, value, suffix }: { label: string; value: number; suffix?: string }) => (
              <div className="flex-1">
                <div className="text-[10px] font-bold tracking-widest text-outline uppercase mb-1">{label}</div>
                <div className="text-3xl md:text-5xl font-black tracking-tighter tabular-nums">
                  {value}
                  {suffix && <span className="text-sm md:text-base text-outline ml-1 font-medium">{suffix}</span>}
                </div>
              </div>
            )
            return (
              <div className="mt-4 md:mt-10 flex gap-6 md:gap-12 max-w-md">
                <Stat label="Today" value={today} />
                <Stat label="Last 7d" value={last7} />
                <Stat label="Streak" value={streak} suffix="d" />
              </div>
            )
          })()}
        </div>
      </section>

      <div className="max-w-[1440px] mx-auto px-6 md:px-12 pb-24 md:py-16">
        <div className="swiss-grid">
          <div className="col-span-12 lg:col-span-6">
            <div className="bg-surface-container-low p-5 md:p-8">
              <h2 className="hidden md:block text-2xl font-black tracking-tighter uppercase mb-8">Save a new article</h2>
              <form onSubmit={handleSubmit} className="space-y-5 md:space-y-6">
                <div>
                  <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-2">
                    Article URL
                  </label>
                  <input
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    enterKeyHint="send"
                    placeholder="https://example.com/article"
                    value={sourceUrl}
                    onChange={e => {
                      setSourceUrl(e.target.value)
                      setError('')
                    }}
                    className="w-full bg-transparent border-b border-outline pb-3 text-base md:text-lg focus:outline-none focus:border-b-2 focus:border-primary"
                  />
                  <p className="text-[11px] text-on-surface-variant mt-3">
                    Paste a link, or share to <span className="font-bold">Capture</span> from your browser. Title and category are optional and saved as entered — there is no auto-extraction.
                  </p>
                </div>

                <div>
                  <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-2">
                    Title <span className="text-outline-variant">(optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="defaults to the URL"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="w-full bg-transparent border-b border-outline pb-3 text-base focus:outline-none focus:border-b-2 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-2">
                    Category <span className="text-outline-variant">(optional)</span>
                  </label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full bg-transparent border-b border-outline pb-3 text-base focus:outline-none focus:border-b-2 focus:border-primary"
                  >
                    <option value="">—</option>
                    {CATEGORIES.map(c => (
                      <option key={c.code} value={c.code}>{c.code}: {c.label}</option>
                    ))}
                  </select>
                </div>

                {error && (
                  <div className="p-3 bg-error/10 border border-error text-error text-xs">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !sourceUrl.trim()}
                  className="w-full bg-primary text-on-primary px-6 py-4 md:py-3 text-sm md:text-xs font-bold tracking-widest uppercase hover:bg-primary-dim transition-colors disabled:opacity-50"
                >
                  {loading ? 'PROCESSING…' : 'CAPTURE'}
                </button>
              </form>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-6 mt-10 lg:mt-0 lg:border-l lg:border-outline-variant/20 lg:pl-12">
            <h2 className="text-xl md:text-2xl font-black tracking-tighter uppercase mb-6 md:mb-8">
              Recent ({entries.length})
            </h2>
            <div className="space-y-6">
              {entries.length === 0 ? (
                <p className="text-on-surface-variant">No entries yet.</p>
              ) : (
                entries.map(entry => (
                  <div key={entry.id} className="pb-6">
                    <div className="flex justify-between items-start mb-2 gap-3">
                      <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase">
                        {CATEGORIES.find(c => c.code === entry.category)?.label ?? entry.category}
                      </span>
                      <span className="text-[10px] font-medium tracking-widest text-outline uppercase whitespace-nowrap">
                        {entry.publicationDate}
                      </span>
                    </div>
                    <h3 className="text-base font-black mb-2">{entry.title}</h3>
                    {entry.contentsSummary && (
                      <p className="text-sm text-on-surface-variant mb-3 line-clamp-2">
                        {entry.contentsSummary}
                      </p>
                    )}
                    <a
                      href={entry.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold tracking-widest text-tertiary uppercase hover:underline"
                    >
                      OPEN SOURCE →
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default function Capture() {
  return <TokenGate>{(token, onAuthFail) => <CaptureBody token={token} onAuthFail={onAuthFail} />}</TokenGate>
}
