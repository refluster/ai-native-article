import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { GAS_URL } from '../lib/gas-config'

interface L1Entry {
  id?: string
  title: string
  sourceUrl: string
  category: 'A' | 'B' | 'C' | 'D' | 'E'
  contentsSummary: string
  publicationDate: string
  notionUrl?: string
}

interface L1FormData {
  sourceUrl: string
}

const CATEGORIES = [
  { code: 'A', label: 'AI Hyper-productivity' },
  { code: 'B', label: 'Role Blurring' },
  { code: 'C', label: 'New Roles / FDE' },
  { code: 'D', label: 'Big Tech Layoffs & AI Pivot' },
  { code: 'E', label: 'Rethinking SDLC' },
]

export default function L1Register() {
  const [entries, setEntries] = useState<L1Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    loadEntries()
  }, [])

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!sourceUrl.trim()) {
      setError('Please enter a URL')
      return
    }

    setLoading(true)
    setError('')
    try {
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'L1_SAVE', sourceUrl: sourceUrl.trim() }),
      })
      const data = await response.json()
      if (data.success) {
        setSourceUrl('')
        await loadEntries()
      } else {
        setError(data.error || 'Failed to register article')
      }
    } catch (error) {
      setError(`Failed to save: ${error}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Header */}
      <section className="w-full bg-surface border-b border-outline-variant/10">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-16 pb-16">
          <Link to="/" className="inline-block text-[10px] font-bold tracking-widest text-outline uppercase mb-10 hover:text-tertiary transition-colors">
            ← INDEX
          </Link>
          <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-none mb-6 uppercase">
            L1: Register Article
          </h1>
          <p className="text-xl text-on-surface-variant max-w-2xl leading-relaxed">
            Register web articles to the AI Transformation Library. These become inputs for creating blog articles in L2.
          </p>
        </div>
      </section>

      {/* Content */}
      <div className="max-w-[1440px] mx-auto px-6 md:px-12 py-16">
        <div className="swiss-grid">
          {/* Form */}
          <div className="col-span-12 lg:col-span-6">
            <div className="bg-surface-container-low p-8">
              <h2 className="text-2xl font-black tracking-tighter uppercase mb-8">Register New Article</h2>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-2">
                    Article URL
                  </label>
                  <p className="text-xs text-on-surface-variant mb-3">
                    Paste the article link. The system will automatically extract the title, summary, category, and publication date.
                  </p>
                  <input
                    type="url"
                    placeholder="https://example.com/article"
                    value={sourceUrl}
                    onChange={e => {
                      setSourceUrl(e.target.value)
                      setError('')
                    }}
                    className="w-full bg-transparent border-b border-outline pb-2 text-base focus:outline-none focus:border-b-2 focus:border-primary"
                  />
                </div>

                {error && (
                  <div className="p-3 bg-error/10 border border-error text-error text-xs">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !sourceUrl.trim()}
                  className="w-full bg-primary text-on-primary px-6 py-3 text-xs font-bold tracking-widest uppercase hover:bg-primary-dim transition-colors disabled:opacity-50"
                >
                  {loading ? 'PROCESSING...' : 'REGISTER'}
                </button>
              </form>
            </div>
          </div>

          {/* List */}
          <div className="col-span-12 lg:col-span-6 lg:border-l lg:border-outline-variant/20 lg:pl-12">
            <h2 className="text-2xl font-black tracking-tighter uppercase mb-8">Recent Entries ({entries.length})</h2>
            <div className="space-y-6">
              {entries.length === 0 ? (
                <p className="text-on-surface-variant">No entries yet.</p>
              ) : (
                entries.map(entry => (
                  <div key={entry.id} className="border-b border-outline-variant/20 pb-6">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase">
                        {CATEGORIES.find(c => c.code === entry.category)?.label}
                      </span>
                      <span className="text-[10px] font-medium tracking-widest text-outline uppercase">
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
