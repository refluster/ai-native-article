import { withBasePath } from '../lib/paths'

/* -----------------------------------------------------------------------
   Design System — The Precision Editorial
   Living reference for all design tokens and components.
----------------------------------------------------------------------- */

function SectionHeader({ label, title }: { label: string; title: string }) {
  return (
    <div className="flex items-end gap-8 mb-12 border-b border-outline-variant/20 pb-6">
      <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase">{label}</span>
      <h2 className="text-3xl font-black tracking-tighter uppercase leading-none">{title}</h2>
    </div>
  )
}

// ─── Colors ──────────────────────────────────────────────────────────────────
const COLOR_TOKENS = [
  { name: 'surface',                  hex: '#f9f9fb', text: 'dark', label: 'Level 0 — Base' },
  { name: 'surface-container-low',    hex: '#f2f4f6', text: 'dark', label: 'Level 1 — Content Areas' },
  { name: 'surface-container-lowest', hex: '#ffffff',  text: 'dark', label: 'Level 2 — Cards / Interactive' },
  { name: 'surface-container-highest',hex: '#dde3e9', text: 'dark', label: 'Level 3 — Overlays' },
  { name: 'on-surface',               hex: '#2d3338', text: 'light', label: 'Primary text' },
  { name: 'on-surface-variant',       hex: '#596065', text: 'light', label: 'Secondary text' },
  { name: 'primary',                  hex: '#5e5e5e', text: 'light', label: 'Primary interactive' },
  { name: 'primary-dim',              hex: '#525252', text: 'light', label: 'Primary hover state' },
  { name: 'on-primary',               hex: '#f8f8f8', text: 'dark',  label: 'Text on primary' },
  { name: 'tertiary',                 hex: '#c1000a', text: 'light', label: 'Signal / Accent' },
  { name: 'on-tertiary',              hex: '#fff7f6', text: 'dark',  label: 'Text on tertiary' },
  { name: 'outline',                  hex: '#757c81', text: 'light', label: 'Icons / placeholders' },
  { name: 'outline-variant',          hex: '#acb3b8', text: 'dark',  label: 'Ghost borders' },
  { name: 'error',                    hex: '#9f403d', text: 'light', label: 'Error state' },
  { name: 'inverse-surface',          hex: '#0c0e10', text: 'light', label: 'Dark overlays' },
]

function ColorSection() {
  return (
    <section className="mb-24">
      <SectionHeader label="01 — Foundation" title="Color Tokens" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-0">
        {COLOR_TOKENS.map(token => (
          <div key={token.name} className="flex flex-col">
            <div
              className="h-24 w-full"
              style={{ backgroundColor: token.hex }}
            />
            <div className="bg-surface-container-low p-3">
              <p className="text-[10px] font-bold text-on-surface uppercase tracking-widest leading-tight mb-1">
                {token.name}
              </p>
              <p className="text-[10px] font-mono text-outline">{token.hex}</p>
              <p className="text-[9px] text-outline-variant mt-1">{token.label}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Typography ───────────────────────────────────────────────────────────────
const TYPE_SCALE = [
  { name: 'Display LG',  size: '3.5rem',    weight: '900', tracking: '-0.02em', usage: 'Hero headings' },
  { name: 'Display MD',  size: '2.75rem',   weight: '900', tracking: '-0.02em', usage: 'Article titles' },
  { name: 'Headline LG', size: '2rem',      weight: '800', tracking: '-0.01em', usage: 'Section headers' },
  { name: 'Headline MD', size: '1.5rem',    weight: '800', tracking: '-0.01em', usage: 'Sub-sections' },
  { name: 'Headline SM', size: '1.25rem',   weight: '800', tracking: '0',       usage: 'Card titles' },
  { name: 'Body LG',     size: '1rem',      weight: '400', tracking: '0',       usage: 'Long-form editorial' },
  { name: 'Body MD',     size: '0.875rem',  weight: '400', tracking: '0',       usage: 'Secondary content' },
  { name: 'Label MD',    size: '0.75rem',   weight: '700', tracking: '0.05em',  usage: 'Metadata, captions' },
  { name: 'Label SM',    size: '0.6875rem', weight: '700', tracking: '0.08em',  usage: 'Tags, eyebrows' },
]

function TypographySection() {
  return (
    <section className="mb-24">
      <SectionHeader label="02 — Foundation" title="Typography Scale" />
      <div className="mb-8 p-6 bg-surface-container-low">
        <p className="text-[10px] font-bold tracking-widest text-outline uppercase mb-2">Typeface</p>
        <p className="text-5xl font-black tracking-tighter">Inter</p>
        <p className="text-sm text-on-surface-variant mt-2">Neo-grotesque. Neutral precision. Swiss masters.</p>
      </div>
      <div className="space-y-0">
        {TYPE_SCALE.map(t => (
          <div key={t.name} className="flex items-baseline gap-8 py-6 border-b border-outline-variant/15">
            <div className="w-28 shrink-0">
              <p className="text-[10px] font-bold tracking-widest text-outline uppercase">{t.name}</p>
              <p className="text-[9px] text-outline-variant mt-1">{t.size} / {t.weight}w</p>
            </div>
            <p
              className="flex-1 text-on-surface leading-tight truncate"
              style={{ fontSize: t.size, fontWeight: t.weight, letterSpacing: t.tracking }}
            >
              The Precision Editorial
            </p>
            <span className="text-[10px] text-outline hidden md:block shrink-0">{t.usage}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Spacing ──────────────────────────────────────────────────────────────────
const SPACING = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24]

function SpacingSection() {
  return (
    <section className="mb-24">
      <SectionHeader label="03 — Foundation" title="Spacing Scale" />
      <p className="text-sm text-on-surface-variant mb-8">Base unit: 4px. All spacing is a multiple of 4px.</p>
      <div className="space-y-3">
        {SPACING.map(n => (
          <div key={n} className="flex items-center gap-6">
            <span className="text-[10px] font-bold tracking-widest text-outline uppercase w-20 shrink-0">
              spacing-{n}
            </span>
            <span className="text-[10px] font-mono text-outline-variant w-12 shrink-0">
              {n * 4}px
            </span>
            <div className="bg-tertiary h-4" style={{ width: n * 4 * 2 }} />
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Grid ─────────────────────────────────────────────────────────────────────
function GridSection() {
  return (
    <section className="mb-24">
      <SectionHeader label="04 — Layout" title="12-Column Swiss Grid" />
      <p className="text-sm text-on-surface-variant mb-8">
        Gap: 24px. Max-width: 1440px. All layout elements must align to this grid.
      </p>
      <div className="grid grid-cols-12 gap-6 mb-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="bg-tertiary/10 border border-tertiary/20 h-12 flex items-center justify-center">
            <span className="text-[9px] font-bold text-tertiary">{i + 1}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-12 gap-6 mb-3">
        <div className="col-span-12 md:col-span-9 bg-surface-container-low h-8 flex items-center px-4">
          <span className="text-[9px] font-bold text-outline uppercase">9 col — main content</span>
        </div>
        <div className="col-span-12 md:col-span-3 bg-surface-container-highest h-8 flex items-center px-4">
          <span className="text-[9px] font-bold text-outline uppercase">3 col — sidebar</span>
        </div>
      </div>
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 md:col-span-7 bg-surface-container-low h-8 flex items-center px-4">
          <span className="text-[9px] font-bold text-outline uppercase">7 col — hero image</span>
        </div>
        <div className="col-span-12 md:col-span-5 bg-surface-container-highest h-8 flex items-center px-4">
          <span className="text-[9px] font-bold text-outline uppercase">5 col — featured copy</span>
        </div>
      </div>
    </section>
  )
}

// ─── Components ───────────────────────────────────────────────────────────────
function ComponentsSection() {
  return (
    <section className="mb-24">
      <SectionHeader label="05 — Components" title="UI Components" />

      {/* Buttons */}
      <div className="mb-16">
        <h3 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-8">BUTTONS</h3>
        <div className="flex flex-wrap gap-6 items-center mb-6">
          <button className="bg-primary text-on-primary px-6 py-3 text-xs font-bold tracking-widest uppercase hover:bg-primary-dim transition-colors">
            Primary Button
          </button>
          <button className="bg-tertiary text-on-tertiary px-6 py-3 text-xs font-bold tracking-widest uppercase">
            Signal (Tertiary)
          </button>
          <button className="border border-outline text-on-surface px-6 py-3 text-xs font-bold tracking-widest uppercase hover:border-on-surface transition-colors">
            Outlined
          </button>
          <button className="text-on-surface px-6 py-3 text-xs font-bold tracking-widest uppercase hover:text-tertiary transition-colors">
            Ghost
          </button>
        </div>
        <div className="bg-surface-container-low p-4">
          <p className="text-[10px] text-on-surface-variant">
            <strong className="text-on-surface">Rule:</strong> 0px radius on all buttons. Transitions max 150ms linear.
            Tertiary button used only for singular, critical CTAs.
          </p>
        </div>
      </div>

      {/* Badges / Tags */}
      <div className="mb-16">
        <h3 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-8">BADGES & TAGS</h3>
        <div className="flex flex-wrap gap-4 items-center mb-6">
          <span className="bg-tertiary text-on-tertiary px-2 py-1 text-[10px] font-bold tracking-widest uppercase">
            FEATURED INSIGHT
          </span>
          <span className="bg-surface-container-low text-on-surface-variant px-2 py-1 text-[10px] font-bold tracking-widest uppercase">
            AI STRATEGY
          </span>
          <span className="text-tertiary text-[10px] font-bold tracking-widest uppercase">
            ORG DESIGN ×
          </span>
          <span className="text-outline text-[10px] font-bold tracking-widest uppercase">
            2026-03-28
          </span>
        </div>
      </div>

      {/* Card */}
      <div className="mb-16">
        <h3 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-8">ARTICLE CARD</h3>
        <div className="max-w-xs">
          <div className="aspect-[4/5] bg-surface-container-low mb-6 overflow-hidden">
            <img
              src={withBasePath('assets/images/article-1.jpg')}
              alt="Sample"
              className="w-full h-full object-cover grayscale"
            />
          </div>
          <div className="flex justify-between items-baseline mb-3">
            <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase">
              CATEGORY × TAG
            </span>
            <span className="text-[10px] font-medium tracking-widest text-outline uppercase">
              2026-03-28
            </span>
          </div>
          <h4 className="text-xl font-extrabold tracking-tight leading-tight mb-4">
            Article Title Goes Here in Two Lines
          </h4>
          <p className="text-sm leading-relaxed text-on-surface-variant line-clamp-3">
            Article abstract text providing context and inviting the reader to explore the full insight.
          </p>
        </div>
        <div className="bg-surface-container-low p-4 mt-6 max-w-lg">
          <p className="text-[10px] text-on-surface-variant">
            <strong className="text-on-surface">Rule:</strong> No divider lines inside cards.
            Separation via spacing-10/spacing-12 and background color blocks.
            Images always 0px radius, grayscale.
          </p>
        </div>
      </div>

      {/* Input */}
      <div className="mb-16">
        <h3 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-8">INPUT FIELDS</h3>
        <div className="max-w-sm space-y-6">
          <div>
            <label className="text-[10px] font-bold tracking-widest text-outline uppercase block mb-2">
              Default
            </label>
            <input
              type="text"
              placeholder="Placeholder text"
              className="w-full bg-transparent border-b border-outline pb-2 text-base text-on-surface focus:outline-none focus:border-b-2 focus:border-primary placeholder:text-outline-variant"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold tracking-widest text-error uppercase block mb-2">
              Error State
            </label>
            <input
              type="text"
              defaultValue="Invalid entry"
              className="w-full bg-transparent border-b-2 border-error pb-2 text-base text-on-surface focus:outline-none"
            />
            <p className="text-[10px] text-error mt-2 tracking-wide">This field is required</p>
          </div>
        </div>
        <div className="bg-surface-container-low p-4 mt-6 max-w-lg">
          <p className="text-[10px] text-on-surface-variant">
            <strong className="text-on-surface">Rule:</strong> Underline-only style.
            Active: 2px primary. Error: error color underline and helper text.
          </p>
        </div>
      </div>

      {/* Navigation indicator */}
      <div className="mb-16">
        <h3 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-8">NAVIGATION — THE SWISS BAR</h3>
        <div className="flex gap-8 border-b border-outline-variant/20">
          {['INDEX', 'DESIGN SYSTEM', 'DESIGN GUIDE'].map((item, i) => (
            <button
              key={item}
              className={`text-xs font-bold tracking-widest uppercase pb-3 transition-colors ${
                i === 0
                  ? 'text-on-surface border-b-2 border-tertiary'
                  : 'text-outline hover:text-on-surface'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="bg-surface-container-low p-4 mt-6 max-w-lg">
          <p className="text-[10px] text-on-surface-variant">
            <strong className="text-on-surface">The Swiss Bar:</strong> 2px tertiary (#c1000a) horizontal underline
            marks the active state. Functions as a surgical "cut" through the monochromatic environment.
          </p>
        </div>
      </div>
    </section>
  )
}

// ─── Elevation ────────────────────────────────────────────────────────────────
function ElevationSection() {
  return (
    <section className="mb-24">
      <SectionHeader label="06 — Foundation" title="Elevation & Depth" />
      <p className="text-sm text-on-surface-variant mb-10">
        Depth through tonal lift — not shadows. Layer surfaces like premium paper stocks.
      </p>
      <div className="flex gap-0 flex-wrap">
        {[
          { label: 'Level 0', bg: '#f9f9fb', name: 'surface', desc: 'Page base' },
          { label: 'Level 1', bg: '#f2f4f6', name: 'container-low', desc: 'Content areas' },
          { label: 'Level 2', bg: '#ffffff',  name: 'container-lowest', desc: 'Cards' },
          { label: 'Level 3', bg: '#dde3e9', name: 'container-highest', desc: 'Overlays' },
        ].map(level => (
          <div
            key={level.label}
            className="flex-1 min-w-[140px] h-40 flex flex-col justify-end p-4 border border-outline-variant/10"
            style={{ backgroundColor: level.bg }}
          >
            <span className="text-[10px] font-bold tracking-widest text-on-surface uppercase block">
              {level.label}
            </span>
            <span className="text-[9px] text-outline">{level.name}</span>
            <span className="text-[9px] text-outline-variant">{level.desc}</span>
          </div>
        ))}
      </div>
      <div className="mt-8 p-6 bg-surface-container-low">
        <p className="text-[10px] font-bold text-outline uppercase mb-3">Ambient Shadow (Exception Only)</p>
        <div
          className="w-48 h-24 bg-surface-container-lowest flex items-center justify-center"
          style={{ boxShadow: '0 24px 48px rgba(45, 51, 56, 0.06)' }}
        >
          <span className="text-[9px] text-outline">Modal / floating</span>
        </div>
        <p className="text-[9px] text-outline-variant mt-3">
          box-shadow: 0 24px 48px rgba(45, 51, 56, 0.06) — Only for truly floating elements.
        </p>
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DesignSystem() {
  return (
    <>
      {/* Page header */}
      <section className="w-full bg-surface border-b border-outline-variant/10">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-16 pb-16">
          <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase block mb-6">
            DOCUMENTATION
          </span>
          <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-none mb-6 uppercase">
            Design System
          </h1>
          <p className="text-xl text-on-surface-variant max-w-2xl leading-relaxed">
            The Precision Editorial — a tribute to the International Typographic Style.
            Grid-based, zero-radius, typographically precise.
          </p>
          <div className="flex items-center gap-6 mt-8 text-[10px] font-bold tracking-widest text-outline uppercase">
            <span>Version 1.0</span>
            <span>Typeface: Inter</span>
            <span>Grid: 12-column</span>
            <span>Radius: 0px</span>
          </div>
        </div>
      </section>

      {/* Navigation within page */}
      <div className="sticky top-16 z-40 bg-surface/95 backdrop-blur border-b border-outline-variant/20">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12">
          <nav className="flex gap-8 overflow-x-auto">
            {['Colors', 'Typography', 'Spacing', 'Grid', 'Components', 'Elevation'].map(item => (
              <a
                key={item}
                href={`#${item.toLowerCase()}`}
                className="text-[10px] font-bold tracking-widest text-outline uppercase py-4 whitespace-nowrap hover:text-on-surface transition-colors"
              >
                {item}
              </a>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-6 md:px-12 py-16">
        <div id="colors"><ColorSection /></div>
        <div id="typography"><TypographySection /></div>
        <div id="spacing"><SpacingSection /></div>
        <div id="grid"><GridSection /></div>
        <div id="components"><ComponentsSection /></div>
        <div id="elevation"><ElevationSection /></div>
      </div>
    </>
  )
}
