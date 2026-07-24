// Component test for StackedAreaChart — the hand-rolled SVG funnel renderer.
// Covers: one polygon per series, the empty-data fallback, and per-day hover
// titles when a tooltip formatter is supplied.

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StackedAreaChart, { type AreaSeries } from './StackedAreaChart';

const SERIES: AreaSeries[] = [
  { key: 'registered', label: 'registered', fill: 'var(--wf-svg-archived)' },
  { key: 'assigned', label: 'assigned', fill: 'var(--wf-svg-primary)' },
  { key: 'delivered', label: 'delivered', fill: 'var(--wf-svg-running)' },
];

const DATA = [
  { date: '2026-06-01', registered: 5, assigned: 3, delivered: 2 },
  { date: '2026-06-02', registered: 2, assigned: 3, delivered: 5 },
];

afterEach(() => cleanup());

describe('StackedAreaChart', () => {
  it('renders one polygon per series', () => {
    const { container } = render(
      <StackedAreaChart data={DATA} xKey="date" series={SERIES} ariaLabel="funnel" />,
    );
    expect(container.querySelectorAll('polygon')).toHaveLength(SERIES.length);
    expect(screen.getByRole('img', { name: 'funnel' })).toBeInTheDocument();
  });

  it('shows the empty-data fallback when given no points', () => {
    render(<StackedAreaChart data={[]} xKey="date" series={SERIES} />);
    expect(screen.getByText(/no data in window/i)).toBeInTheDocument();
  });

  it('emits a per-day hover title when a tooltip formatter is given', () => {
    const { container } = render(
      <StackedAreaChart
        data={DATA}
        xKey="date"
        series={SERIES}
        tooltip={(d) => `${d.date}: ${d.delivered}`}
      />,
    );
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent);
    expect(titles).toContain('2026-06-01: 2');
    expect(titles).toContain('2026-06-02: 5');
  });

  // Regression for a pr-autopilot cycle-1 finding (2026-07-24, `wf:owen`):
  // AreaSeries.opacity (DomainSkillMaturityPanel's one-hue Dreyfus gradient)
  // had no assertion — a typo'd/index-shifted opacity would render and pass
  // every prior test.
  it('applies each series own opacity, defaulting to 0.85 when omitted', () => {
    const OPACITY_SERIES: AreaSeries[] = [
      { key: 'registered', label: 'registered', fill: 'var(--wf-svg-archived)', opacity: 0.3 },
      { key: 'assigned', label: 'assigned', fill: 'var(--wf-svg-primary)', opacity: 1 },
      { key: 'delivered', label: 'delivered', fill: 'var(--wf-svg-running)' },
    ];
    const { container } = render(
      <StackedAreaChart data={DATA} xKey="date" series={OPACITY_SERIES} />,
    );
    const polygons = [...container.querySelectorAll('polygon')];
    expect(polygons.map((p) => p.getAttribute('fill-opacity'))).toEqual(['0.3', '1', '0.85']);
  });
});
