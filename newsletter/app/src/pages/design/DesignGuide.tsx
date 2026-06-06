/* -----------------------------------------------------------------------
   Design Guide — The Precision Editorial
   Principles, rules, and usage guidelines.
----------------------------------------------------------------------- */

function SectionHeader({ label, title }: { label: string; title: string }) {
  return (
    <div className="flex items-end gap-8 mb-12 border-b border-outline-variant/20 pb-6">
      <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase">{label}</span>
      <h2 className="text-3xl font-black tracking-tighter uppercase leading-none">{title}</h2>
    </div>
  )
}

function RuleBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-tertiary pl-6 mb-8">
      <h4 className="text-xs font-black tracking-widest uppercase mb-3">{title}</h4>
      <div className="text-sm leading-relaxed text-on-surface-variant space-y-2">{children}</div>
    </div>
  )
}

function GuideSection({
  id, label, title, children,
}: {
  id: string; label: string; title: string; children: React.ReactNode
}) {
  return (
    <section id={id} className="mb-24">
      <SectionHeader label={label} title={title} />
      {children}
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DesignGuide() {
  return (
    <>
      {/* Page header */}
      <section className="w-full bg-surface border-b border-outline-variant/10">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-16 pb-16">
          <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase block mb-6">
            DOCUMENTATION
          </span>
          <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-none mb-6 uppercase">
            Design Guide
          </h1>
          <p className="text-xl text-on-surface-variant max-w-2xl leading-relaxed">
            Principles, rules, and usage guidelines for designing with the Precision Editorial system.
            Read this before touching a component.
          </p>
        </div>
      </section>

      {/* Sticky nav */}
      <div className="sticky top-16 z-40 bg-surface/95 backdrop-blur border-b border-outline-variant/20">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12">
          <nav className="flex gap-8 overflow-x-auto">
            {['Philosophy', 'Colors', 'Typography', 'Surfaces', 'Components', 'Dos & Donts', 'Accessibility'].map(item => (
              <a
                key={item}
                href={`#${item.toLowerCase().replace(/[^a-z]/g, '-')}`}
                className="text-[10px] font-bold tracking-widest text-outline uppercase py-4 whitespace-nowrap hover:text-on-surface transition-colors"
              >
                {item}
              </a>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-6 md:px-12 py-16">

        {/* ── Philosophy ──────────────────────────────────────────────── */}
        <GuideSection id="philosophy" label="01 — Overview" title="Creative North Star">
          <div className="bg-inverse-surface text-on-primary p-10 mb-10">
            <p className="text-2xl font-black tracking-tight leading-tight mb-4">
              "The Mathematical Monolith"
            </p>
            <p className="text-base leading-relaxed opacity-80 max-w-2xl">
              This design system rejects the "template" look of modern web design in favor of a
              rigorous, grid-based architecture that prioritizes clarity, objective photography, and
              extreme typographic hierarchy.
            </p>
          </div>

          <RuleBlock title="Moving Away from the Soft Web">
            <p>
              A <strong className="text-on-surface">0px border-radius</strong> across the entire system creates a
              visual language of precision and authority. This is non-negotiable.
            </p>
            <p>
              The "bespoke" feel comes from tension between massive <code className="bg-surface-container-low px-1.5 py-0.5 text-xs">display</code> type
              and generous, intentional whitespace — Negative Space as a Content Element.
            </p>
          </RuleBlock>

          <RuleBlock title="Floating Anchors">
            <p>
              Break the traditional symmetrical grid with "Floating Anchors" — metadata or captions
              that sit in the margins. This creates a sophisticated, editorial layout that feels
              curated rather than generated.
            </p>
          </RuleBlock>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 mt-10">
            {[
              { principle: 'Precision', desc: 'Every element placed with mathematical intentionality. No accidental gaps.' },
              { principle: 'Authority', desc: 'Bold typographic hierarchy commands attention before imagery.' },
              { principle: 'Restraint', desc: 'The palette does one thing well. Red is reserved for signal, not decoration.' },
            ].map(p => (
              <div key={p.principle} className="bg-surface-container-low p-8 border-r border-outline-variant/20 last:border-r-0">
                <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase block mb-4">
                  Principle
                </span>
                <h3 className="text-2xl font-black tracking-tighter mb-3">{p.principle}</h3>
                <p className="text-sm text-on-surface-variant leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </GuideSection>

        {/* ── Colors ──────────────────────────────────────────────────── */}
        <GuideSection id="colors" label="02 — Visual Language" title="Color Usage">
          <RuleBlock title="The No-Line Rule">
            <p>
              Sectioning must <strong className="text-on-surface">never</strong> be achieved through 1px solid borders.
              Boundaries are defined exclusively through background shifts.
            </p>
            <p>
              A side-rail using <code className="bg-surface-container-low px-1.5 py-0.5 text-xs">surface-container-low</code> (#f2f4f6)
              sits directly against a <code className="bg-surface-container-low px-1.5 py-0.5 text-xs">surface</code> (#f9f9fb) main content area —
              no border, no divider.
            </p>
          </RuleBlock>

          <RuleBlock title="The Glass & Gradient Rule">
            <p>
              To prevent the monochromatic palette from feeling "flat," use Glassmorphism for floating
              navigation or sticky headers:
            </p>
            <pre className="bg-inverse-surface text-on-primary text-xs p-4 mt-2 overflow-x-auto font-mono">
              {`background: rgba(249, 249, 251, 0.90);
backdrop-filter: blur(20px);`}
            </pre>
          </RuleBlock>

          <RuleBlock title="Signature Textures">
            <p>
              Main CTAs or Hero sections use a subtle linear gradient from
              <code className="bg-surface-container-low px-1.5 py-0.5 text-xs mx-1">primary</code> (#5e5e5e) to
              <code className="bg-surface-container-low px-1.5 py-0.5 text-xs mx-1">primary-dim</code> (#525252) —
              a metallic architectural sheen.
            </p>
          </RuleBlock>

          <RuleBlock title="Tertiary Red — Use with Discipline">
            <p>
              <code className="bg-surface-container-low px-1.5 py-0.5 text-xs">tertiary</code> (#c1000a) is your
              single accent color. Use it for:
            </p>
            <ul className="space-y-1 mt-2">
              {[
                'The Swiss Bar (active nav underline)',
                'Featured badges ("FEATURED INSIGHT")',
                'Category labels',
                'Single critical CTA buttons',
                'Article card title hover state',
              ].map(item => (
                <li key={item} className="flex gap-2 items-start">
                  <span className="text-tertiary font-bold shrink-0">—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-on-surface font-bold">Never use it for decorative purposes.</p>
          </RuleBlock>
        </GuideSection>

        {/* ── Typography ──────────────────────────────────────────────── */}
        <GuideSection id="typography" label="03 — Visual Language" title="Typography Rules">
          <div className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-0">
            <div className="bg-surface-container-low p-8">
              <p className="text-[10px] font-bold tracking-widest text-outline uppercase mb-6">The Dramatic Scale</p>
              <p className="text-[56px] font-black tracking-tighter leading-none text-on-surface mb-2">3.5rem</p>
              <p className="text-[11px] font-bold tracking-widest text-outline uppercase">display-lg title</p>
              <div className="my-4 h-[1px] bg-outline-variant/20" />
              <p className="text-[11px] font-bold tracking-widest text-outline uppercase">2026-03-28</p>
              <p className="text-[10px] text-outline mt-1">label-sm date</p>
            </div>
            <div className="bg-surface p-8 flex flex-col justify-center">
              <p className="text-sm text-on-surface-variant leading-relaxed">
                This scale contrast is the engine of the "High-End" feel. A{' '}
                <strong className="text-on-surface">display-lg (3.5rem)</strong> title may sit directly above a{' '}
                <strong className="text-on-surface">label-sm (0.6875rem)</strong> date.
              </p>
              <p className="text-sm text-on-surface-variant leading-relaxed mt-4">
                Intentional drama — not an accident, not an afterthought.
              </p>
            </div>
          </div>

          <RuleBlock title="Tracking Rules">
            <ul className="space-y-2">
              <li><strong className="text-on-surface">Display / Headline:</strong> −0.02em to −0.01em. Tight. Creates a "block" of text.</li>
              <li><strong className="text-on-surface">Body:</strong> 0em. Let the letterforms breathe naturally.</li>
              <li><strong className="text-on-surface">Labels / Metadata:</strong> +0.05em to +0.08em. All-caps with wide tracking for technical/corporate look.</li>
            </ul>
          </RuleBlock>

          <RuleBlock title="Hierarchy is Non-Negotiable">
            <p>
              Every page must have a clear typographic anchor — one dominant element that the eye goes
              to first. On the homepage, that's the hero headline. On an article, it's the h1.
            </p>
            <p>
              Secondary elements should feel intentionally subordinate, not accidentally smaller.
            </p>
          </RuleBlock>
        </GuideSection>

        {/* ── Surfaces ────────────────────────────────────────────────── */}
        <GuideSection id="surfaces" label="04 — Layout" title="Surface Hierarchy & Nesting">
          <p className="text-base text-on-surface-variant mb-10 max-w-2xl leading-relaxed">
            Treat the UI as a series of stacked, premium paper stocks. Each level adds perceived
            depth without shadow.
          </p>

          <div className="space-y-0">
            {[
              { level: 'Level 0', token: 'surface', hex: '#f9f9fb', desc: 'The page itself. Never place content directly on white.' },
              { level: 'Level 1', token: 'surface-container-low', hex: '#f2f4f6', desc: 'Content areas, sidebars, section backgrounds.' },
              { level: 'Level 2', token: 'surface-container-lowest', hex: '#ffffff', desc: 'Cards, interactive elements — they "lift" from L1.' },
              { level: 'Level 3', token: 'surface-container-highest', hex: '#dde3e9', desc: 'Overlays, popovers, modals. Rare usage.' },
            ].map((s, i) => (
              <div key={s.level} className="flex items-stretch gap-0 border-b border-outline-variant/15">
                <div
                  className="w-24 shrink-0"
                  style={{ backgroundColor: s.hex }}
                />
                <div className="flex-1 p-6">
                  <div className="flex items-baseline gap-4 mb-2">
                    <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase">
                      {s.level}
                    </span>
                    <code className="text-[10px] font-mono text-outline">{s.token}</code>
                    <span className="text-[10px] font-mono text-outline-variant">{s.hex}</span>
                  </div>
                  <p className="text-sm text-on-surface-variant">{s.desc}</p>
                </div>
                <div className="w-8 shrink-0 bg-surface-container-low flex items-center justify-center">
                  <span className="text-[9px] text-outline">{i}</span>
                </div>
              </div>
            ))}
          </div>
        </GuideSection>

        {/* ── Components ──────────────────────────────────────────────── */}
        <GuideSection id="components" label="05 — Components" title="Component Guidelines">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
            {[
              {
                component: 'Buttons',
                rules: [
                  'Shape: strictly 0px radius',
                  'Primary: bg-primary, text-on-primary, hover → bg-primary-dim',
                  'Tertiary (Signal): only for the single most critical CTA on a page',
                  'Transitions: max 150ms linear — "snappy and mechanical"',
                ],
              },
              {
                component: 'Cards',
                rules: [
                  'Absolute prohibition of divider lines inside cards',
                  'Use spacing-10/spacing-12 to separate content modules',
                  'Images: 0px radius, always grayscale',
                  'Captions: label-sm, placed asymmetrically (outside container)',
                ],
              },
              {
                component: 'Input Fields',
                rules: [
                  'Underline-only — no box, no outline',
                  'Default: 1px outline color underline',
                  'Active: 2px primary color underline',
                  'Error: error color underline + helper text',
                ],
              },
              {
                component: 'Navigation',
                rules: [
                  'The Swiss Bar: 2px tertiary bottom border = active state',
                  'Inactive items: outline color, hover → on-surface',
                  'Glassmorphism for sticky/fixed nav: 90% opacity + blur',
                  'Max-width 1440px, centered',
                ],
              },
            ].map(c => (
              <div key={c.component} className="bg-surface-container-low p-8 border-b border-r border-outline-variant/15">
                <h3 className="text-sm font-black uppercase tracking-widest mb-6">{c.component}</h3>
                <ul className="space-y-3">
                  {c.rules.map(rule => (
                    <li key={rule} className="text-sm text-on-surface-variant flex gap-3">
                      <span className="text-tertiary font-bold shrink-0">—</span>
                      <span>{rule}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </GuideSection>

        {/* ── Do's & Don'ts ───────────────────────────────────────────── */}
        <GuideSection id="dos---donts" label="06 — Rules" title="Do's & Don'ts">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
            <div className="bg-surface-container-low p-10">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-4 h-4 bg-tertiary" />
                <h3 className="text-sm font-black uppercase tracking-widest">Do</h3>
              </div>
              <ul className="space-y-6">
                {[
                  { title: 'Use the Grid', desc: 'Align every element to the 12-column grid. Typography should "hang" from grid lines.' },
                  { title: 'Embrace Whitespace', desc: 'If a section feels crowded, double the spacing value. Move from spacing-8 to spacing-16.' },
                  { title: 'Contrast with Purpose', desc: 'Pair darkest on-surface text with lightest surface backgrounds for maximum precision.' },
                  { title: 'Let Typography Lead', desc: 'Headlines before images. Text hierarchy establishes reading order before the eye reaches photography.' },
                  { title: 'Use Grayscale Photography', desc: 'All article imagery is desaturated. Color is reserved for UI meaning, not image decoration.' },
                ].map(item => (
                  <li key={item.title}>
                    <p className="text-sm font-black text-on-surface mb-1">{item.title}</p>
                    <p className="text-sm text-on-surface-variant">{item.desc}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-surface p-10 border-l border-outline-variant/20">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-4 h-4 border-2 border-outline" />
                <h3 className="text-sm font-black uppercase tracking-widest">Don't</h3>
              </div>
              <ul className="space-y-6">
                {[
                  { title: 'No Rounded Corners', desc: 'Never use a border-radius. Even 2px is too soft for this system. 0px is the rule.' },
                  { title: 'No Divider Lines', desc: 'Do not use 1px lines to separate list items. Use spacing-4 and subtle background shifts.' },
                  { title: 'No Standard Blue', desc: 'Avoid default web blues. Use tertiary red or monochromatic grays only.' },
                  { title: 'No Over-Animation', desc: 'Avoid bouncy or "playful" transitions. Use linear or ease-out transforms, never spring/bounce.' },
                  { title: 'No Multiple Accents', desc: 'Tertiary red is the single accent. Do not introduce a second accent color for visual variety.' },
                ].map(item => (
                  <li key={item.title}>
                    <p className="text-sm font-black text-on-surface mb-1">{item.title}</p>
                    <p className="text-sm text-on-surface-variant">{item.desc}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </GuideSection>

        {/* ── Accessibility ───────────────────────────────────────────── */}
        <GuideSection id="accessibility" label="07 — Standards" title="Accessibility">
          <p className="text-base text-on-surface-variant mb-10 max-w-2xl leading-relaxed">
            Despite the monochromatic palette, accessibility is non-negotiable.
            The Swiss precision aesthetic must not come at the cost of legibility.
          </p>

          <div className="space-y-0">
            {[
              {
                rule: 'Text Contrast',
                requirement: 'Minimum 4.5:1',
                detail: 'on-surface (#2d3338) on surface (#f9f9fb) achieves 10.8:1. Always verify when placing text on custom backgrounds.',
                status: 'Required',
              },
              {
                rule: 'Icon Visibility',
                requirement: 'outline token only',
                detail: 'Use #757c81 (outline) for icons to ensure visibility across all surface-container tiers.',
                status: 'Required',
              },
              {
                rule: 'Ghost Border Fallback',
                requirement: 'outline-variant at 15% opacity',
                detail: 'When accessibility requires a container boundary that cannot be conveyed via background shift alone, use outline-variant (#acb3b8) at 15% opacity.',
                status: 'As needed',
              },
              {
                rule: 'Interactive States',
                requirement: 'Focus visible',
                detail: 'All interactive elements must have a visible focus indicator. Use a 2px tertiary outline offset by 2px.',
                status: 'Required',
              },
              {
                rule: 'Motion',
                requirement: 'Respect prefers-reduced-motion',
                detail: 'Wrap all CSS transitions in a media query check. Users with vestibular disorders should see no animation.',
                status: 'Required',
              },
            ].map(item => (
              <div key={item.rule} className="grid grid-cols-12 gap-6 py-6 border-b border-outline-variant/15">
                <div className="col-span-12 md:col-span-3">
                  <p className="text-sm font-black text-on-surface">{item.rule}</p>
                  <code className="text-[10px] font-mono text-outline block mt-1">{item.requirement}</code>
                </div>
                <div className="col-span-12 md:col-span-7">
                  <p className="text-sm text-on-surface-variant leading-relaxed">{item.detail}</p>
                </div>
                <div className="col-span-12 md:col-span-2 flex md:justify-end items-start">
                  <span className={`text-[9px] font-bold tracking-widest uppercase px-2 py-1 ${
                    item.status === 'Required'
                      ? 'bg-tertiary text-on-tertiary'
                      : 'bg-surface-container-low text-outline'
                  }`}>
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </GuideSection>

      </div>
    </>
  )
}
