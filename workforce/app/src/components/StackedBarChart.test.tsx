// Component test for StackedBarChart — the hand-rolled div-based stacked bar
// renderer extracted from PrAutomationPanel (2026-07-24). Mirrors
// StackedAreaChart.test.tsx's shape: bottom-first stacking order, the
// empty-data fallback, and per-bar hover titles.
//
// Regression for a pr-autopilot cycle-1 finding (`wf:owen`): this component
// had zero tests despite being a 4x-reused primitive (PrAutomationPanel +
// 3x RepoPerformancePanel) with a non-obvious DOM-order inversion
// (`bottomFirst = [...series].reverse()`) that a refactor could silently flip.

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StackedBarChart, { type BarSeries } from './StackedBarChart';

const SERIES: BarSeries[] = [
  { key: 'autopilot_merged', label: 'autopilot-merged', fill: 'var(--wf-svg-running)' },
  { key: 'human', label: 'human-involved', fill: 'var(--wf-svg-paused)' },
];

const DATA = [{ date: '2026-06-01', autopilot_merged: 3, human: 2 }];

afterEach(() => cleanup());

describe('StackedBarChart', () => {
  it('stacks the first-listed series (bottom→top convention) at the visual bottom', () => {
    const { container } = render(<StackedBarChart data={DATA} xKey="date" series={SERIES} />);
    // The bar's segment divs are the innermost styled children — grab them by
    // their inline backgroundColor and confirm DOM order = reverse(series),
    // so series[0] ("bottom") renders as the LAST DOM child (closest to the
    // baseline under flex-col + justify-end).
    const segments = [...container.querySelectorAll('div[style*="background-color"]')];
    expect(segments).toHaveLength(2);
    expect(segments[0].getAttribute('style')).toContain('var(--wf-svg-paused)'); // human — top
    expect(segments[1].getAttribute('style')).toContain('var(--wf-svg-running)'); // autopilot_merged — bottom
  });

  it('omits a zero-value series segment instead of rendering an empty div', () => {
    const { container } = render(
      <StackedBarChart data={[{ date: '2026-06-01', autopilot_merged: 5, human: 0 }]} xKey="date" series={SERIES} />,
    );
    const segments = container.querySelectorAll('div[style*="background-color"]');
    expect(segments).toHaveLength(1);
  });

  it('shows the empty-data fallback when given no bars', () => {
    render(<StackedBarChart data={[]} xKey="date" series={SERIES} />);
    expect(screen.getByText(/no data in window/i)).toBeInTheDocument();
  });

  it('emits a per-bar hover title when a tooltip formatter is given, under the given ariaLabel', () => {
    const { container } = render(
      <StackedBarChart
        data={DATA}
        xKey="date"
        series={SERIES}
        ariaLabel="pr throughput"
        tooltip={(d) => `${d.date}: ${d.autopilot_merged} autopilot`}
      />,
    );
    expect(screen.getByRole('img', { name: 'pr throughput' })).toBeInTheDocument();
    const bar = container.querySelector('[title]');
    expect(bar?.getAttribute('title')).toBe('2026-06-01: 3 autopilot');
  });
});
