import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

interface L2Entry {
  id: string
  title: string
}

interface L3Entry {
  id?: string
  title: string
  l2EntryIds: string[]
  abstract: string
  category: string
  status: 'draft' | 'review' | 'published'
}

export default function L3Insight() {
  const [l2Entries, setL2Entries] = useState<L2Entry[]>([])
  const [l3Entries, setL3Entries] = useState<L3Entry[]>([])
  const [selectedL2Ids, setSelectedL2Ids] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadEntries()
  }, [])

  async function loadEntries() {
    try {
      const l2Response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/usercontent', {
        method: 'POST',
        body: JSON.stringify({ action: 'L2_LIST' }),
      })
      const l2Data = await l2Response.json()
      if (l2Data.success) setL2Entries(l2Data.data || [])

      const l3Response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/usercontent', {
        method: 'POST',
        body: JSON.stringify({ action: 'L3_LIST' }),
      })
      const l3Data = await l3Response.json()
      if (l3Data.success) setL3Entries(l3Data.data || [])
    } catch (error) {
      console.error('Failed to load entries:', error)
    }
  }

  async function handleCreate() {
    if (!title || !category || selectedL2Ids.length === 0) {
      alert('Please fill in all fields and select articles')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/usercontent', {
        method: 'POST',
        body: JSON.stringify({
          action: 'L3_CREATE',
          title,
          category,
          l2EntryIds: selectedL2Ids,
        }),
      })
      const data = await response.json()
      if (data.success) {
        setTitle('')
        setCategory('')
        setSelectedL2Ids([])
        await loadEntries()
      } else {
        alert(`Error: ${data.error}`)
      }
    } catch (error) {
      alert(`Failed: ${error}`)
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
            L3: Create Insight Article
          </h1>
          <p className="text-xl text-on-surface-variant max-w-2xl">
            Synthesize multiple blog articles into a deep-dive insight article.
          </p>
        </div>
      </section>

      <div className="max-w-[1440px] mx-auto px-6 md:px-12 py-16">
        <div className="swiss-grid">
          <div className="col-span-12 lg:col-span-6 bg-surface-container-low p-8">
            <h2 className="text-2xl font-black tracking-tighter uppercase mb-8">New Insight Article</h2>
            <div className="space-y-6">
              <div>
                <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-2">
                  Title
                </label>
                <input
                  type="text"
                  placeholder="Insight article title"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full bg-transparent border-b border-outline pb-2 text-base focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-2">
                  Category
                </label>
                <input
                  type="text"
                  placeholder="E.g., AI STRATEGY × ORG DESIGN"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="w-full bg-transparent border-b border-outline pb-2 text-base focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-4">
                  Select Blog Articles
                </label>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {l2Entries.map(entry => (
                    <label key={entry.id} className="flex items-center gap-3 p-2 hover:bg-surface cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedL2Ids.includes(entry.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedL2Ids([...selectedL2Ids, entry.id])
                          } else {
                            setSelectedL2Ids(selectedL2Ids.filter(id => id !== entry.id))
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">{entry.title}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full bg-primary text-on-primary px-6 py-3 text-xs font-bold tracking-widest uppercase hover:bg-primary-dim transition-colors disabled:opacity-50"
              >
                {loading ? 'GENERATING...' : 'GENERATE INSIGHT'}
              </button>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-6 lg:border-l lg:border-outline-variant/20 lg:pl-12">
            <h2 className="text-2xl font-black tracking-tighter uppercase mb-8">Insight Articles ({l3Entries.length})</h2>
            <div className="space-y-6">
              {l3Entries.map(entry => (
                <div key={entry.id} className="border-b border-outline-variant/20 pb-6">
                  <div className="flex justify-between items-start mb-2">
                    <span className={`text-[10px] font-bold tracking-widest uppercase px-2 py-1 ${entry.status === 'draft' ? 'bg-surface-container-low text-outline' : 'bg-tertiary text-on-tertiary'}`}>
                      {entry.status}
                    </span>
                    <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase">
                      {entry.category}
                    </span>
                  </div>
                  <h3 className="text-base font-black mb-2">{entry.title}</h3>
                  <p className="text-sm text-on-surface-variant line-clamp-2 mb-2">
                    {entry.abstract}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
