import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { WORKFORCE_BASE_URL } from '../config/site'
import { setOperatorSeo } from '../lib/seo'

// The operator surfaces, collected off the reader's daily path. These are
// tools and references — internal navigation, design docs, capture, and the
// workforce console — not reading destinations. Routes still resolve
// directly (existing bookmarks keep working); this page just gives them a
// single home so the public header/footer can stay reader-only.
interface OperatorLink {
  label: string
  desc: string
  to?: string
  href?: string
}

const internalLinks: OperatorLink[] = [
  {
    to: '/sources',
    label: 'ORIGINAL SOURCES',
    desc: '取り上げた一次情報の一覧。各出典から解説・分析・元記事へ。',
  },
  {
    to: '/capture',
    label: 'CAPTURE',
    desc: 'L1ソースの登録フォーム（運営者のみ）。',
  },
  {
    to: '/design-system',
    label: 'DESIGN SYSTEM',
    desc: 'カラー・タイポgrid等のリビングリファレンス。',
  },
  {
    to: '/design-guide',
    label: 'DESIGN GUIDE',
    desc: '編集原則と利用ルール。',
  },
]

const externalLinks: OperatorLink[] = [
  {
    href: WORKFORCE_BASE_URL,
    label: 'WORKFORCE ↗',
    desc: 'エージェント組織コンソール（別オリジン・認証あり）。',
  },
]

function LinkCard({ link }: { link: OperatorLink }) {
  const body = (
    <>
      <span className="text-sm font-black tracking-tight uppercase group-hover:text-tertiary transition-colors block mb-2">
        {link.label}
      </span>
      <span className="text-xs leading-relaxed text-on-surface-variant">
        {link.desc}
      </span>
    </>
  )
  const cls =
    'group block bg-surface-container-lowest p-6 hover:bg-surface-container-low transition-colors'
  return link.to ? (
    <Link to={link.to} className={cls}>
      {body}
    </Link>
  ) : (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className={cls}>
      {body}
    </a>
  )
}

export default function Operator() {
  useEffect(() => {
    setOperatorSeo()
  }, [])

  return (
    <>
      <section className="w-full bg-surface border-b border-outline-variant/10">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-16 pb-12">
          <span className="inline-block text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
            OPERATOR
          </span>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight leading-tight mb-6">
            運営ツール
          </h1>
          <p className="text-base md:text-lg leading-relaxed text-on-surface-variant max-w-3xl">
            読み手向けではない、運営者用のツールとリファレンスをここに集約しています。
            <Link to="/" className="text-tertiary underline underline-offset-2 hover:no-underline ml-1">
              トップへ戻る →
            </Link>
          </p>
        </div>
      </section>

      <section className="max-w-[1440px] mx-auto px-6 md:px-12 py-12">
        <h2 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
          SITE
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-12">
          {internalLinks.map(link => (
            <LinkCard key={link.label} link={link} />
          ))}
        </div>

        <h2 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
          EXTERNAL
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {externalLinks.map(link => (
            <LinkCard key={link.label} link={link} />
          ))}
        </div>
      </section>
    </>
  )
}
