// The public surfaces' shared vocabulary — the class strings the landing
// page, Docs and Research all compose from, so the three read as one site.
//
// The landing page set the tone: Geist display type on the Cool Mist
// canvas, mono uppercase kickers, pill buttons, white lifted cards with a
// 1px hairline — and very few horizontal rules. Sections are separated by
// whitespace, not lines; the only rules left are the ones inside data
// (table rows) and the two-pixel quote rails. Everything here is built
// from the wf-* tokens in tailwind.config.ts (lint:tokens), so the whole
// public site re-themes from that map.

/** Mono uppercase label above a heading (neutral). */
export const KICKER = 'font-wfmono text-[11px] uppercase tracking-[0.18em] text-wf-on-surface-variant';

/** Same label in Indigo Ink — used on cards and inside documents. */
export const KICKER_ACCENT = 'font-wfmono text-[11px] uppercase tracking-[0.16em] text-wf-primary';

/** Page hero title, display size (landing, Docs, document covers). */
export const H1 = 'font-headline font-bold text-[clamp(36px,6vw,64px)] leading-[1.05] tracking-[-0.03em] text-wf-on-surface';

/** Page hero title, sentence size (Research index, article titles). */
export const H1_MD = 'font-headline font-bold text-[clamp(28px,4.2vw,42px)] leading-[1.12] tracking-[-0.022em] text-wf-on-surface';

/** Section heading. */
export const H2 = 'font-headline font-bold text-[clamp(24px,3.2vw,32px)] leading-[1.15] tracking-[-0.015em] text-wf-on-surface';

/** The paragraph under a hero title. */
export const LEDE = 'text-[clamp(16px,1.8vw,19px)] leading-relaxed text-wf-on-surface-variant max-w-[60ch]';

/** Section body copy under an H2. */
export const SECTION_LEDE = 'text-[16px] leading-relaxed text-wf-on-surface-variant max-w-[64ch]';

/** Vertical rhythm of a page section. Whitespace does the separating. */
export const SECTION = 'py-12 sm:py-14';

/** Filled pill (the one primary action on a page). */
export const PILL_PRIMARY =
  'inline-flex items-center justify-center whitespace-nowrap font-wfmono text-[12px] uppercase tracking-[0.16em] px-6 py-3 rounded-full bg-wf-primary text-wf-on-primary hover:opacity-90 transition-opacity';

/** Outlined pill (secondary action, pagination). */
export const PILL_SECONDARY =
  'inline-flex items-center justify-center whitespace-nowrap font-wfmono text-[12px] uppercase tracking-[0.16em] px-6 py-3 rounded-full border border-wf-outline text-wf-on-surface hover:border-wf-primary hover:text-wf-primary transition-colors';

/** Compact filled pill for the header. */
export const PILL_PRIMARY_SM =
  'inline-flex items-center justify-center whitespace-nowrap font-wfmono text-[11px] uppercase tracking-[0.16em] px-4 py-2 rounded-full bg-wf-primary text-wf-on-primary hover:opacity-90 transition-opacity';

/** White lifted card (§Elevation: a hairline, never a shadow). */
export const CARD = 'bg-wf-surface-container-lo border border-wf-outline-variant rounded-wf-md';

/** A card that is a link: hover raises the hairline to Indigo Ink. */
export const CARD_LINK = `block ${CARD} hover:border-wf-primary transition-colors`;

/** Mono uppercase text link (breadcrumbs, "← back", footers). */
export const TEXT_LINK =
  'font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-on-surface-variant hover:text-wf-primary transition-colors';

/** Tag / filter chip, resting state. */
export const CHIP =
  'font-wfmono text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-wf-lg border border-wf-outline-variant bg-wf-surface-container text-wf-on-surface-variant hover:border-wf-primary hover:text-wf-primary transition-colors';

/** Tag / filter chip, active (inverted to Indigo Ink). */
export const CHIP_ACTIVE =
  'font-wfmono text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-wf-lg border border-wf-primary bg-wf-primary text-wf-on-primary transition-colors';

/** Inline "Clear" / "All tags" style action. */
export const INLINE_ACTION = 'font-wfmono text-[11px] uppercase tracking-[0.12em] text-wf-tertiary hover:underline';
