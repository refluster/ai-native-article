import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

interface L3Entry {
  id: string
  title: string
  abstract: string
}

interface L4Entry {
  id?: string
  title: string
  slug: string
  publishedUrl?: string
  status: 'draft' | 'ready' | 'published'
}

export default function L4Publish() {
  const [l3Entries, setL3Entries] = useState<L3Entry[]>([])
  const [l4Entries, setL4Entries] = useState<L4Entry[]>([])
  const [selectedL3Ids, setSelectedL3Ids] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadEntries()
  }, [])

  async function loadEntries() {
    try {
      const l3Response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/usercontent', {
        method: 'POST',
        body: JSON.stringify({ action: 'L3_LIST' }),
      })
      const l3Data = await l3Response.json()
      if (l3Data.success) setL3Entries(l3Data.data || [])

      const l4Response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/usercontent', {
        method: 'POST',
        body: JSON.stringify({ action: 'L4_LIST' }),
      })
      const l4Data = await l4Response.json()
      if (l4Data.success) setL4Entries(l4Data.data || [])
    } catch (error) {
      console.error('Failed to load entries:', error)
    }
  }

  async function handlePublish() {
    if (selectedL3Ids.length === 0) {
      alert('Please select articles to publish')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/usercontent', {
        method: 'POST',
        body: JSON.stringify({
          action: 'L4_PUBLISH',
          l3EntryIds: selectedL3Ids,
        }),
      })
      const data = await response.json()
      if (data.success) {
        setSelectedL3Ids([])
        await loadEntries()
        alert(`Successfully published ${data.data?.length || 0} article(s)!`)
      } else {
        alert(`Error: ${data.error}`)
      }
    } catch (error) {
      alert(`Failed: ${error}`)
    } finally {
      setLoading(false)
    }
  }

  const unpublishedL3 = l3Entries.filter(e => !l4Entries.find(l4 => l4.id === e.id))

  return (
    <>
      <section className="w-full bg-surface border-b border-outline-variant/10">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-16 pb-16">
          <Link to="/" className="inline-block text-[10px] font-bold tracking-widest text-outline uppercase mb-10 hover:text-tertiary">
            ← INDEX
          </Link>
          <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-none mb-6 uppercase">
            L4: Publish Article
          </h1>
          <p className="text-xl text-on-surface-variant max-w-2xl">
            Publish insight articles to kohuehara.xyz. This updates GitHub and the manifest.
          </p>
        </div>
      </section>

      <div className="max-w-[1440px] mx-auto px-6 md:px-12 py-16">
        <div className="swiss-grid">
          <div className="col-span-12 lg:col-span-6 bg-surface-container-low p-8">
            <h2 className="text-2xl font-black tracking-tighter uppercase mb-8">Ready to Publish</h2>

            {unpublishedL3.length === 0 ? (
              <p className="text-on-surface-variant mb-6">All articles are published.</p>
            ) : (
              <>
                <div className="space-y-2 max-h-96 overflow-y-auto mb-8">
                  {unpublishedL3.map(entry => (
                    <label key={entry.id} className="flex items-start gap-3 p-3 hover:bg-surface cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedL3Ids.includes(entry.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedL3Ids([...selectedL3Ids, entry.id])
                          } else {
                            setSelectedL3Ids(selectedL3Ids.filter(id => id !== entry.id))
                          }
                        }}
                        className="w-4 h-4 mt-1 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold mb-1">{entry.title}</p>
                        <p className="text-xs text-on-surface-variant line-clamp-2">
                          {entry.abstract}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>

                <button
                  onClick={handlePublish}
                  disabled={loading || selectedL3Ids.length === 0}
                  className="w-full bg-tertiary text-on-tertiary px-6 py-3 text-xs font-bold tracking-widest uppercase hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {loading ? 'PUBLISHING...' : 'PUBLISH TO WEB'}
                </button>
              </>
            )}
          </div>

          <div className="col-span-12 lg:col-span-6 lg:border-l lg:border-outline-variant/20 lg:pl-12">
            <h2 className="text-2xl font-black tracking-tighter uppercase mb-8">Published ({l4Entries.length})</h2>
            <div className="space-y-6">
              {l4Entries.map(entry => (
                <div key={entry.id} className="border-b border-outline-variant/20 pb-6">
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <h3 className="text-base font-black flex-1">{entry.title}</h3>
                    <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase px-2 py-1 whitespace-nowrap">
                      LIVE
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-outline-variant mb-2 truncate">
                    /{entry.slug}
                  </p>
                  {entry.publishedUrl && (
                    <a
                      href={entry.publishedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold tracking-widest text-tertiary uppercase hover:underline"
                    >
                      VIEW ON GITHUB →
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
