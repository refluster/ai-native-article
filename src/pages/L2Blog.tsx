import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { GAS_URL } from '../lib/gas-config'

interface L1Entry {
  id: string
  title: string
  sourceUrl: string
  contentsSummary: string
  category: string
}

interface L2Entry {
  id?: string
  title: string
  l1EntryId: string
  blogContent: string
  status: 'draft' | 'review' | 'published'
}

export default function L2Blog() {
  const [l1Entries, setL1Entries] = useState<L1Entry[]>([])
  const [l2Entries, setL2Entries] = useState<L2Entry[]>([])
  const [selectedL1Id, setSelectedL1Id] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadEntries()
  }, [])

  async function loadEntries() {
    try {
      const l1Response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'L1_LIST' }),
      })
      const l1Data = await l1Response.json()
      if (l1Data.success) setL1Entries(l1Data.data || [])

      const l2Response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'L2_LIST' }),
      })
      const l2Data = await l2Response.json()
      if (l2Data.success) setL2Entries(l2Data.data || [])
    } catch (error) {
      console.error('Failed to load entries:', error)
    }
  }

  async function handleCreate() {
    if (!selectedL1Id) {
      setError('Please select an article')
      return
    }

    setLoading(true)
    setError('')
    try {
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'L2_CREATE',
          l1EntryId: selectedL1Id,
        }),
      })
      const data = await response.json()
      if (data.success) {
        setSelectedL1Id('')
        await loadEntries()
      } else {
        setError(data.error || 'Failed to generate blog')
      }
    } catch (error) {
      setError(`Failed: ${error}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <section className="w-full bg-surface border-b border-outline-variant/10">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-16 pb-16">
          <Link to="/" className="inline-block text-[10px] font-bold tracking-widest text-outline uppercase mb-10 hover:text-tertiary">
            ← INDEX
          </Link>
          <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-none mb-6 uppercase">
            L2: Create Blog Article
          </h1>
          <p className="text-xl text-on-surface-variant max-w-2xl">
            Select an article and generate a blog post using Azure OpenAI.
          </p>
        </div>
      </section>

      <div className="max-w-[1440px] mx-auto px-6 md:px-12 py-16">
        <div className="swiss-grid">
          <div className="col-span-12 lg:col-span-6 bg-surface-container-low p-8">
            <h2 className="text-2xl font-black tracking-tighter uppercase mb-8">Generate Blog Article</h2>
            <div className="space-y-6">
              <div>
                <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-4">
                  Select Source Article
                </label>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {l1Entries.length === 0 ? (
                    <p className="text-on-surface-variant text-sm">No articles registered yet. Go to L1 to register articles.</p>
                  ) : (
                    l1Entries.map(entry => (
                      <label key={entry.id} className="flex items-start gap-3 p-3 hover:bg-surface cursor-pointer border border-transparent hover:border-outline-variant/50">
                        <input
                          type="radio"
                          name="l1-entry"
                          value={entry.id}
                          checked={selectedL1Id === entry.id}
                          onChange={e => {
                            setSelectedL1Id(e.target.value)
                            setError('')
                          }}
                          className="w-4 h-4 mt-1 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold mb-1">{entry.title}</p>
                          <p className="text-xs text-on-surface-variant line-clamp-2 mb-1">
                            {entry.contentsSummary}
                          </p>
                          <p className="text-[10px] font-mono text-outline-variant">
                            {entry.category}
                          </p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {error && (
                <div className="p-3 bg-error/10 border border-error text-error text-xs">
                  {error}
                </div>
              )}

              <button
                onClick={handleCreate}
                disabled={loading || !selectedL1Id}
                className="w-full bg-primary text-on-primary px-6 py-3 text-xs font-bold tracking-widest uppercase hover:bg-primary-dim transition-colors disabled:opacity-50"
              >
                {loading ? 'GENERATING...' : 'GENERATE BLOG'}
              </button>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-6 lg:border-l lg:border-outline-variant/20 lg:pl-12">
            <h2 className="text-2xl font-black tracking-tighter uppercase mb-8">Blog Articles ({l2Entries.length})</h2>
            <div className="space-y-6">
              {l2Entries.length === 0 ? (
                <p className="text-on-surface-variant">No blog articles generated yet.</p>
              ) : (
                l2Entries.map(entry => (
                  <div key={entry.id} className="border-b border-outline-variant/20 pb-6">
                    <div className="flex justify-between items-start mb-2">
                      <span className={`text-[10px] font-bold tracking-widest uppercase px-2 py-1 ${entry.status === 'draft' ? 'bg-surface-container-low text-outline' : 'bg-tertiary text-on-tertiary'}`}>
                        {entry.status}
                      </span>
                    </div>
                    <h3 className="text-base font-black mb-2">{entry.title}</h3>
                    <p className="text-xs text-on-surface-variant line-clamp-3">
                      {entry.blogContent?.substring(0, 150)}...
                    </p>
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
