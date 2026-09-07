---
name: Cognitive Network
colors:
  surface: '#f8fafb'
  surface-dim: '#d8dadb'
  surface-bright: '#f8fafb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f5'
  surface-container: '#eceeef'
  surface-container-high: '#e6e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#45464f'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#eff1f2'
  outline: '#767680'
  outline-variant: '#c6c5d0'
  surface-tint: '#515c8a'
  primary: '#0f1b46'
  on-primary: '#ffffff'
  primary-container: '#26315c'
  on-primary-container: '#8f9acc'
  inverse-primary: '#b9c4f8'
  secondary: '#50634f'
  on-secondary: '#ffffff'
  secondary-container: '#d2e9ce'
  on-secondary-container: '#556954'
  tertiary: '#351600'
  on-tertiary: '#ffffff'
  tertiary-container: '#532804'
  on-tertiary-container: '#ce8d62'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dde1ff'
  primary-fixed-dim: '#b9c4f8'
  on-primary-fixed: '#0c1842'
  on-primary-fixed-variant: '#394470'
  secondary-fixed: '#d2e9ce'
  secondary-fixed-dim: '#b6cdb3'
  on-secondary-fixed: '#0e1f0f'
  on-secondary-fixed-variant: '#384b38'
  tertiary-fixed: '#ffdcc6'
  tertiary-fixed-dim: '#feb788'
  on-tertiary-fixed: '#311300'
  on-tertiary-fixed-variant: '#6b3b16'
  background: '#f8fafb'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  headline-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  data-label:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.02em
  data-value:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.4'
  caption:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 32px
  container-max: 1280px
---

## Brand & Style

The design system is engineered for cognitive clarity, organizational efficiency, and high-stakes judgment. It targets a professional audience within complex network environments—researchers, analysts, and system architects—who require a safe, systematic, and focused workspace.

### The mark

The console's identity mark is one solid node above two open ones, joined by
two edges, white on an Indigo Ink rounded square. It is the MVV as a glyph:
humans hold the constitutional layer and set direction (the filled steward
node), agents carry execution beneath it (the open nodes), and the edges are
the delegation an org chart is made of.

`workforce/app/public/favicon.svg` is the source of truth for its geometry.
`scripts/generate-icons.mjs` rasterises the same geometry to the PNG sizes
that will not take an SVG (`apple-touch-icon`, the 192/512 manifest icons),
and `components/BrandMark.tsx` re-draws it in React from design tokens for
the in-app wordmark. Edit the SVG, then re-run the generator — three
lookalikes that drift apart is the failure mode this arrangement prevents.

The aesthetic follows a **Modern Corporate** approach with a **Technical** edge. It prioritizes information density without sacrificing legibility. The interface utilizes a structured, "grid-first" layout philosophy to evoke a sense of stability and institutional trust. Visual noise is aggressively reduced to elevate the data and decision-making pathways, ensuring that the UI acts as a silent, reliable partner in the user's workflow.

## Colors

The color palette is anchored by **Indigo Ink**, a deep, authoritative primary that establishes a professional foundation. The background utilizes **Cool Mist** to provide a low-strain, neutral canvas that differentiates subtly from pure white surfaces.

**Sage** is employed for secondary actions and balanced organizational elements, providing a calming, organic counterpoint to the technical rigor of the primary indigo. **Pale Copper** is used sparingly as an accent for call-to-actions or critical network nodes, ensuring high visibility without inducing alarm. Text and iconography rely on high-contrast variants of the primary color to maintain accessibility standards.

## Typography

This design system uses a dual-font strategy to separate narrative from data. 

**Geist** serves as the primary typeface for all headings and body copy. Its clean, geometric sans-serif construction provides a contemporary and neutral tone that scales beautifully across high-density interfaces. 

**JetBrains Mono** is reserved strictly for data-driven elements, labels, and technical identifiers. The monospaced nature of the font ensures that numerical values and network IDs align predictably, aiding in rapid scanning and pattern recognition. Use medium weights for labels to ensure they stand out against the body text.

## Layout & Spacing

The layout is built on a **12-column fluid grid** for desktop, transitioning to 8 columns for tablet and 4 for mobile. A strict 4px base-unit defines the spacing rhythm, ensuring all elements align to a systematic vertical and horizontal rhythm.

Content containers are padded generously to prevent information overload. Gutters are fixed at 24px to provide clear visual separation between data modules. On mobile, margins shrink to **12px** to maximize screen real estate, while complex data tables may utilize horizontal overflow to preserve the integrity of monospaced data columns.

### Mobile edge-to-edge

The 12px mobile margin is the floor for *prose and controls*, not for
list-shaped content. Feed cards, roster rows, and any other repeating band
go **full-bleed** on phones: they cancel the page gutter, drop their side
borders and corner radius, and span the viewport, separated from each other
by a single horizontal rule. On a 390px screen the old inset cost ~8% of the
width to margin on both edges of every card — width the data wanted.

Mechanically this is the `wf-bleed-x` utility (`index.css`), whose negative
inline margin is defined to cancel exactly the container's mobile gutter and
to become inert from `sm` up. A card that opts in pairs it with
`border-y sm:border` and `rounded-none sm:rounded-wf-md`, so the inset,
rounded card returns at tablet width and above. If the container gutter ever
changes, `wf-bleed-x` moves with it — they are one decision in two places.

## Elevation & Depth

Hierarchy is established primarily through **Tonal Layers** rather than heavy shadows. The base interface uses the "Cool Mist" background, while active work surfaces and cards use a pure white fill to "lift" them toward the user.

When depth is required for modals or popovers, use **low-opacity ambient shadows** (8-12% opacity) tinted with the Primary Indigo color to maintain a cohesive atmosphere. Subtle 1px borders in a slightly darker neutral tone are preferred over shadows for defining section boundaries, reinforcing the "organized" and "structured" brand personality.

## Shapes

The design system utilizes a **Rounded** shape language (0.5rem base radius). This specific level of roundedness strikes a balance between the precision of a technical tool and the approachability of a modern professional application. 

Large containers and cards should use `rounded-xl` (1.5rem) to create clear, soft-edged boundaries, while smaller interactive elements like buttons and input fields utilize the standard 0.5rem radius to maintain a compact, efficient feel.

## Components

### Buttons
Primary buttons use the Indigo Ink background with white text. Secondary buttons use a Sage outline. All buttons feature a 0.5rem radius and use Geist Medium for the label.

### Input Fields
Inputs are defined by a 1px border in a mid-tone neutral. Upon focus, the border shifts to Indigo Ink. Labels always use JetBrains Mono in a "data-label" style to signify the technical nature of the input.

### Cards & Modules
Data modules use a white background with a subtle border. Titles are Geist Semibold. Within cards, use JetBrains Mono for any displayed metrics or system statuses.

### Chips & Tags
Used for network status or categories. They feature a low-saturation background (derived from Sage or Pale Copper) with high-contrast text. Use the `rounded-lg` (1rem) setting to make them distinct from square-ish buttons.

### Loading states

A page never blocks its whole render on its slowest fetch. Each region loads
independently (`lib/useAsync.ts`) and paints a **skeleton** in the shape of
the content that will replace it (`components/Skeleton.tsx`), so nothing
reflows when the data lands. Page chrome that needs no data — headers,
breadcrumbs, filter chips, tab bars — renders on the first frame and stays
interactive throughout.

Skeletons use the recessed `surface-container` tone with a white shimmer
sweep, honour `prefers-reduced-motion`, and are `aria-hidden` behind a single
`role="status"` announcement per region — a screen reader should hear
"loading crew roster", not twelve empty boxes.

Loading is not the only non-happy state: a failure in a *secondary* region
degrades that region loudly (an inline error line in Pale Copper) while the
rest of the page renders. Only a failure in the region the page exists to
show may take the whole page. This is C-4 (fail loud) applied at region
granularity rather than page granularity.

### Global navigation

The header carries every destination as an icon + label row from `md` up.
Below `md` those destinations collapse behind a hamburger into a right-hand
drawer; the brand mark, global search, and the unread badge stay in the bar.
The drawer is built from the same list as the desktop row — same order, same
icons, same labels, with grouping headers added because a vertical list needs
scent that adjacency gives a horizontal one for free. Adding a destination
means adding it once.

### Network Graphs
Visualization components should use the secondary (Sage) and tertiary (Pale Copper) colors to denote different node types or connection strengths, ensuring the primary Indigo remains the dominant structural anchor.

## Research (the reading surface)

`/research` and `/research/:slug` put the article corpus the reader site
publishes (`https://kohuehara.xyz/ai-native-article/`, Notion-authored, see
`newsletter/docs/DESIGN.md` for *that* surface's "Precision Editorial" system)
inside this console. Same text, this system. The rules below are what
"Cognitive Network, applied to long-form prose" means; the component
inventory is in [`docs/design/research-surface.md`](docs/design/research-surface.md).

### Chrome

Public pages (landing, Research) share one shell, `components/PublicShell.tsx`:
brand mark + wordmark on the left, the public destinations (**Research**,
**Docs**) and the sign-in / open-console pill on the right, a mono uppercase
footer. It is deliberately *not* GlobalNav — every GlobalNav destination is
gated, and a visitor must never be bounced to the Hosted UI by a link that
looked public. The landing column is `max-w-5xl`; the Research index widens
to 1200px because it carries the console's 12-column grid (list + rail).

### Index

- **Analyses only, newest first**, flat tag chips, `?tag=` / `?page=` in the
  URL, a client-side search box — the reader IA of
  `docs/adr/adr-0002-daily-use-reader-ia.md`, unchanged. Explanations are
  reachable from each analysis's *Sources used* section, not listed.
- Cards use the Reports card grammar: white lifted surface, 1px
  `outline-variant` border, `rounded-wf-md`, a mono meta line
  (`date · type · ja · en`), a Geist Bold 19px title, a 3-line clamped
  abstract, then tag chips and a mono `by …` byline. Hover raises the
  border to Indigo Ink, not a shadow (§Elevation). On phones the card stays
  inset: the public shell's gutter is not the console's, so `wf-bleed-x`
  does not apply.
- Tag chips are the §Chips shape (`rounded-wf-lg`) in the recessed
  `surface-container` tone; the active chip inverts to Indigo Ink.
- The rail holds the tag cloud (top 8, expandable) and an *About this
  corpus* card whose figures are JetBrains Mono (data, §Typography).

### Article

- Measure **780px**. Body **17px / 1.8** Geist — the corpus is
  Japanese-first and CJK wants the taller leading; the reader site's 16px
  Inter measure is the same text at a different voice.
- Headings: Geist Bold, `-0.015em` tracking, `h2` with a hairline
  underline, `h4` demoted to a mono data-label so a fourth level never
  competes with the second.
- Links Indigo Ink, hover Pale Copper; blockquotes a 2px Pale Copper rule;
  code and tables on `surface-container` with `outline-variant` hairlines;
  images `rounded-wf-md` with a border. All of it is `.research-prose` in
  `index.css`, applied through tokens so the block re-themes with the map.
- Header: tag chips → title (`clamp(26px, 4vw, 40px)`) → byline (Sigil
  portrait + name + role, the same face the agent directory shows) → a
  mono meta row (date, *Explanation · 解説* on explanations, Spotify) → the
  lead, only when the export's `abstract` is not just the body's opening
  again.
- Edition: a **JA / EN** pill toggle in the breadcrumb row. `?lang=` wins,
  then the stored choice, then the browser. When English is asked for and
  no EN edition exists, the Japanese body is served *with a notice*
  (ADR-0005; C-4 forbids the silent version).
- Footer: back to the index, and *Reader edition on kohuehara.xyz ↗* — the
  canonical URL stays on the reader site while both surfaces publish.

### What is not here

No dark theme (the console has none), no reading-progress analytics
(GA4 page views only — the reader site keeps the scroll-depth funnel), no
comments, no per-reader state (C-3).
