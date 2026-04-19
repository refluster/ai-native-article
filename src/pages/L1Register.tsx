import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { GAS_URL } from '../lib/gas-config'

interface L1Entry {
  id?: string
  title: string
  sourceUrl: string
  category: 'A' | 'B' | 'C' | 'D' | 'E'
  contentsSummary: string
  publicationDate: string
  notionUrl?: string
  createdAt?: string
}

interface L1Stats {
  today: number
  last7: number
  streak: number
}

function computeStats(entries: L1Entry[]): L1Stats {
  // Bucket entries by local-calendar day (YYYY-MM-DD via sv-SE locale).
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
  // Streak: consecutive days with ≥1 entry, ending today. Today=0 gets 1 grace
  // day (the streak doesn't break until you miss yesterday too).
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

export default function L1Register() {
  const [entries, setEntries] = useState<L1Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [error, setError] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const autoSubmitted = useRef(false)

  useEffect(() => {
    loadEntries()
  }, [])

  // Handle incoming share-target payload: prefill + auto-submit once.
  useEffect(() => {
    if (autoSubmitted.current) return
    const shared = extractUrl(searchParams)
    if (!shared) return
    autoSubmitted.current = true
    setSourceUrl(shared)
    // Strip params from the URL so a pull-to-refresh doesn't re-submit.
    setSearchParams({}, { replace: true })
    void submit(shared)
  }, [searchParams, setSearchParams])

  async function loadEntries() {
    try {
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'L1_LIST' }),
      })
      const data = await response.json()
      if (data.success) setEntries(data.data || [])
    } catch (error) {
      console.error('Failed to load entries:', error)
    }
  }

  async function submit(url: string) {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'L1_SAVE', sourceUrl: url }),
      })
      const data = await response.json()
      if (data.success) {
        setSourceUrl('')
        await loadEntries()
      } else {
        setError(data.error || 'Failed to register article')
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
      {/* Header — compact on mobile so the input sits above the fold */}
      <section className="w-full bg-surface">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-6 md:pt-16 pb-6 md:pb-16">
          <Link to="/" className="inline-block text-[10px] font-bold tracking-widest text-outline uppercase mb-4 md:mb-10 hover:text-tertiary transition-colors">
            ← INDEX
          </Link>
          <h1 className="text-3xl md:text-7xl font-black tracking-tighter leading-none mb-2 md:mb-6 uppercase">
            L1: Register
          </h1>
          <p className="hidden md:block text-xl text-on-surface-variant max-w-2xl leading-relaxed">
            Register web articles to the AI Transformation Library. These become inputs for creating blog articles in L2.
          </p>

          {/* Stats strip — "daily habit" signal */}
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

      {/* Content */}
      <div className="max-w-[1440px] mx-auto px-6 md:px-12 pb-24 md:py-16">
        <div className="swiss-grid">
          {/* Form */}
          <div className="col-span-12 lg:col-span-6">
            <div className="bg-surface-container-low p-5 md:p-8">
              <h2 className="hidden md:block text-2xl font-black tracking-tighter uppercase mb-8">Register New Article</h2>
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
                    Paste a link, or share to <span className="font-bold">L1</span> from your browser. Title, summary, category, and date are extracted automatically.
                  </p>
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
                  {loading ? 'PROCESSING…' : 'REGISTER'}
                </button>
              </form>
            </div>
          </div>

          {/* List */}
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
                        {CATEGORIES.find(c => c.code === entry.category)?.label}
                      </span>
                      <span className="text-[10px] font-medium tracking-widest text-outline uppercase whitespace-nowrap">
                        {entry.publicationDate}
                      </span>
                    </div>
                    <h3 className="text-base font-black mb-2">{entry.title}</h3>
                    <p className="text-sm text-on-surface-variant mb-3 line-clamp-2">
                      {entry.contentsSummary}
                    </p>
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
