import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

interface L1Entry {
  id?: string
  title: string
  sourceUrl: string
  category: 'A' | 'B' | 'C' | 'D' | 'E'
  contentsSummary: string
  publicationDate: string
  notionUrl?: string
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
  const [form, setForm] = useState<L1Entry>({
    title: '',
    sourceUrl: '',
    category: 'A',
    contentsSummary: '',
    publicationDate: new Date().toISOString().split('T')[0],
  })

  useEffect(() => {
    loadEntries()
  }, [])

  async function loadEntries() {
    try {
      const response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/usercontent', {
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
    if (!form.title || !form.sourceUrl) {
      alert('Please fill in all fields')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/usercontent', {
        method: 'POST',
        body: JSON.stringify({ action: 'L1_SAVE', ...form }),
      })
      const data = await response.json()
      if (data.success) {
        setForm({
          title: '',
          sourceUrl: '',
          category: 'A',
          contentsSummary: '',
          publicationDate: new Date().toISOString().split('T')[0],
        })
        await loadEntries()
      } else {
        alert(`Error: ${data.error}`)
      }
    } catch (error) {
      alert(`Failed to save: ${error}`)
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
                    Title
                  </label>
                  <input
                    type="text"
                    placeholder="Article title"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    className="w-full bg-transparent border-b border-outline pb-2 text-base focus:outline-none focus:border-b-2 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-2">
                    Source URL
                  </label>
                  <input
                    type="url"
                    placeholder="https://..."
                    value={form.sourceUrl}
                    onChange={e => setForm({ ...form, sourceUrl: e.target.value })}
                    className="w-full bg-transparent border-b border-outline pb-2 text-base focus:outline-none focus:border-b-2 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-2">
                    Category
                  </label>
                  <select
                    value={form.category}
                    onChange={e => setForm({ ...form, category: e.target.value as any })}
                    className="w-full bg-surface px-3 py-2 border border-outline text-base focus:outline-none focus:border-primary"
                  >
                    {CATEGORIES.map(c => (
                      <option key={c.code} value={c.code}>
                        {c.code}: {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-2">
                    Summary
                  </label>
                  <textarea
                    placeholder="2-3 sentence summary of article contents"
                    value={form.contentsSummary}
                    onChange={e => setForm({ ...form, contentsSummary: e.target.value })}
                    rows={4}
                    className="w-full bg-transparent border border-outline p-3 text-base focus:outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-2">
                    Publication Date
                  </label>
                  <input
                    type="date"
                    value={form.publicationDate}
                    onChange={e => setForm({ ...form, publicationDate: e.target.value })}
                    className="w-full bg-transparent border-b border-outline pb-2 text-base focus:outline-none focus:border-b-2 focus:border-primary"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary text-on-primary px-6 py-3 text-xs font-bold tracking-widest uppercase hover:bg-primary-dim transition-colors disabled:opacity-50"
                >
                  {loading ? 'SAVING...' : 'REGISTER'}
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
