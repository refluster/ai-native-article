import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

interface L1Entry {
  id: string
  title: string
}

interface L2Entry {
  id?: string
  title: string
  l1EntryIds: string[]
  blogContent: string
  status: 'draft' | 'review' | 'published'
}

export default function L2Blog() {
  const [l1Entries, setL1Entries] = useState<L1Entry[]>([])
  const [l2Entries, setL2Entries] = useState<L2Entry[]>([])
  const [selectedL1Ids, setSelectedL1Ids] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadEntries()
  }, [])

  async function loadEntries() {
    try {
      const l1Response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/usercontent', {
        method: 'POST',
        body: JSON.stringify({ action: 'L1_LIST' }),
      })
      const l1Data = await l1Response.json()
      if (l1Data.success) setL1Entries(l1Data.data || [])

      const l2Response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/usercontent', {
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
    if (!title || selectedL1Ids.length === 0) {
      alert('Please select articles and enter a title')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/usercontent', {
        method: 'POST',
        body: JSON.stringify({
          action: 'L2_CREATE',
          title,
          l1EntryIds: selectedL1Ids,
        }),
      })
      const data = await response.json()
      if (data.success) {
        setTitle('')
        setSelectedL1Ids([])
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
            L2: Create Blog Article
          </h1>
          <p className="text-xl text-on-surface-variant max-w-2xl">
            Select L1 articles and generate a synthesized blog post using Azure OpenAI.
          </p>
        </div>
      </section>

      <div className="max-w-[1440px] mx-auto px-6 md:px-12 py-16">
        <div className="swiss-grid">
          <div className="col-span-12 lg:col-span-6 bg-surface-container-low p-8">
            <h2 className="text-2xl font-black tracking-tighter uppercase mb-8">New Blog Article</h2>
            <div className="space-y-6">
              <div>
                <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-2">
                  Title
                </label>
                <input
                  type="text"
                  placeholder="Blog article title"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full bg-transparent border-b border-outline pb-2 text-base focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-4">
                  Select Source Articles
                </label>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {l1Entries.map(entry => (
                    <label key={entry.id} className="flex items-center gap-3 p-2 hover:bg-surface cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedL1Ids.includes(entry.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedL1Ids([...selectedL1Ids, entry.id])
                          } else {
                            setSelectedL1Ids(selectedL1Ids.filter(id => id !== entry.id))
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
                {loading ? 'GENERATING...' : 'GENERATE BLOG'}
              </button>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-6 lg:border-l lg:border-outline-variant/20 lg:pl-12">
            <h2 className="text-2xl font-black tracking-tighter uppercase mb-8">Blog Articles ({l2Entries.length})</h2>
            <div className="space-y-6">
              {l2Entries.map(entry => (
                <div key={entry.id} className="border-b border-outline-variant/20 pb-6">
                  <div className="flex justify-between items-start mb-2">
                    <span className={`text-[10px] font-bold tracking-widest uppercase px-2 py-1 ${entry.status === 'draft' ? 'bg-surface-container-low text-outline' : 'bg-tertiary text-on-tertiary'}`}>
                      {entry.status}
                    </span>
                  </div>
                  <h3 className="text-base font-black mb-2">{entry.title}</h3>
                  <p className="text-[10px] text-outline-variant mb-2">
                    {entry.l1EntryIds.length} source article{entry.l1EntryIds.length !== 1 ? 's' : ''}
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
