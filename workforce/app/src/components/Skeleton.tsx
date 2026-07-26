// Skeleton-screen primitives for the console's progressive rendering.
//
// The rule these encode: a loading region keeps the SHAPE of the content
// that will replace it, so the page doesn't reflow when data lands and the
// operator can read the layout before the bytes arrive. Sizes here are
// matched to the real components (Sigil is 40/48/88px, the KPI readout is a
// 4-up grid, the crew table is a 12-col row) — if one of those changes, the
// matching skeleton should move with it.
//
// Everything is `aria-hidden` and the live region carries the announcement
// instead: a screen reader should hear "loading crew index", not twelve
// empty boxes. Shimmer respects prefers-reduced-motion (see index.css).

import { type ReactNode } from 'react'

interface BlockProps {
  /** Tailwind sizing/utility classes — width, height, rounding. */
  className?: string
}

/** One shimmering placeholder box. */
export function Skeleton({ className = '' }: BlockProps) {
  return <span aria-hidden className={`wf-skeleton block rounded-wf-sm ${className}`} />
}

/** A circular placeholder — avatars, status dots. */
export function SkeletonCircle({ size = 40 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="wf-skeleton block rounded-full shrink-0"
      style={{ width: size, height: size }}
    />
  )
}

/** N stacked text lines; the last one is short, like real ragged prose. */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden className={`block space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/5' : 'w-full'}`} />
      ))}
    </span>
  )
}

/**
 * Announces a loading region to assistive tech while its skeleton paints.
 * Wrap each independently-loading region so the page reports progress per
 * panel instead of one page-level "Loading…".
 */
export function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** Bordered card wrapper matching the console's panel chrome. */
function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`border border-wf-outline-variant bg-wf-surface-container-lo rounded-none sm:rounded-wf-md wf-bleed-x ${className}`}
    >
      {children}
    </div>
  )
}

/** The 4-up KPI readout (Dashboard hero, agent-profile hero). */
export function SkeletonKPIReadout({ count = 4 }: { count?: number }) {
  return (
    <LoadingRegion label="Loading key figures">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4"
          >
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-7 w-16 mt-3" />
            <Skeleton className="h-2.5 w-24 mt-3" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  )
}

/** Roster rows — the crew table (`/agents`) and the dashboard crew list. */
export function SkeletonRosterRows({ rows = 6 }: { rows?: number }) {
  return (
    <LoadingRegion label="Loading crew roster">
      <Panel className="overflow-hidden">
        <ul className="divide-y divide-wf-outline-variant">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3.5">
              <SkeletonCircle size={40} />
              <div className="flex-1 min-w-0 space-y-2">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-3.5 w-40 max-w-full" />
              </div>
              <Skeleton className="hidden md:block h-5 w-20" />
              <Skeleton className="hidden md:block h-3 w-10" />
            </li>
          ))}
        </ul>
      </Panel>
    </LoadingRegion>
  )
}

/** Feed post cards (`/`). */
export function SkeletonPostCards({ cards = 3 }: { cards?: number }) {
  return (
    <LoadingRegion label="Loading feed">
      <div className="space-y-3 sm:space-y-4">
        {Array.from({ length: cards }, (_, i) => (
          <Panel key={i} className="p-4 sm:p-5">
            <div className="flex items-start gap-3 mb-4">
              <SkeletonCircle size={40} />
              <div className="flex-1 min-w-0 space-y-2">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-2.5 w-28" />
              </div>
              <Skeleton className="h-5 w-20 shrink-0" />
            </div>
            <SkeletonText lines={4} />
          </Panel>
        ))}
      </div>
    </LoadingRegion>
  )
}

/** A generic rail card — the feed's left/right sidebars. */
export function SkeletonRailCard({ rows = 3 }: { rows?: number }) {
  return (
    <LoadingRegion label="Loading network activity">
      <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4">
        <Skeleton className="h-3.5 w-32 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <SkeletonCircle size={32} />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-3 w-28 max-w-full" />
                <Skeleton className="h-2.5 w-20 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  )
}

/** The agent-profile hero: avatar + name + role + about. */
export function SkeletonProfileHero() {
  return (
    <LoadingRegion label="Loading agent profile">
      <div className="flex flex-col md:flex-row md:items-start gap-4 sm:gap-6">
        <SkeletonCircle size={88} />
        <div className="flex-1 min-w-0">
          <Skeleton className="h-4 w-40 mb-3" />
          <Skeleton className="h-9 sm:h-12 w-64 max-w-full mb-2" />
          <Skeleton className="h-3 w-52 max-w-full" />
          <SkeletonText lines={2} className="mt-4 max-w-prose" />
        </div>
      </div>
    </LoadingRegion>
  )
}

/** A generic bordered panel body — profile sub-panels, charts. */
export function SkeletonPanel({ label, lines = 4 }: { label: string; lines?: number }) {
  return (
    <LoadingRegion label={label}>
      <Panel>
        <div className="border-b border-wf-outline-variant px-4 py-3">
          <Skeleton className="h-3 w-44 max-w-full" />
        </div>
        <div className="p-4">
          <SkeletonText lines={lines} />
        </div>
      </Panel>
    </LoadingRegion>
  )
}
