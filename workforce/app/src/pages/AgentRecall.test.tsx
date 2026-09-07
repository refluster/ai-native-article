// Component test for the recall console (Epic-010 Story 4, #93).
//
// What it guards: the page renders the four fields the Story's acceptance
// criteria name (skill_name, started_at, status, summary) plus the artefact
// deep-link and the similarity score; it calls the recall fetcher scoped to
// the slug in the route, with the operator's k; a blank query never fires a
// request; and a failing fetch surfaces the error instead of painting an
// empty "nothing matched" list (C-4).

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../lib/agents', () => ({
  apiConfigured: () => true,
  fetchAgentRecall: vi.fn(),
  RECALL_K_MAX: 100,
}));

// WorkforceLayout pulls the whole nav (search, auth, manifest loads); the
// page's own markup is what's under test.
vi.mock('../components/WorkforceLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { fetchAgentRecall } from '../lib/agents';
import AgentRecall, { formatScore, hitSummary } from './AgentRecall';

const HIT = {
  exec_ulid: '01J0A98765',
  project_id: 'agent-workforce',
  agent_slug: 'ren',
  skill_name: 'issue-implement',
  skill_version: '0.1.0',
  started_at: '2026-08-05T05:47:00Z',
  ended_at: '2026-08-05T05:52:00Z',
  status: 'ok' as const,
  summary: 'Opened draft PR 547 for issue 398 — cfn-lint CI gate over workforce/infra.',
  artifact_ref: {
    uri: 'https://github.com/refluster/ai-native-article/pull/547',
    content_hash: '0'.repeat(64),
    content_type: 'text/markdown',
    size_bytes: 0,
    summary: 'draft PR 547',
  },
  score: 0.8123,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/agents/ren/recall']}>
      <Routes>
        <Route path="/agents/:slug/recall" element={<AgentRecall />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function submit(query: string) {
  fireEvent.change(screen.getByPlaceholderText(/what did I conclude/i), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: /recall/i }));
}

beforeEach(() => {
  (fetchAgentRecall as Mock).mockReset();
});
afterEach(cleanup);

describe('formatScore', () => {
  it('renders three decimals so near-ties stay distinguishable', () => {
    expect(formatScore(0.8123)).toBe('0.812');
    expect(formatScore(0.8129)).toBe('0.813');
  });
  it('degrades to a dash on a non-finite score', () => {
    expect(formatScore(Number.NaN)).toBe('—');
  });
});

describe('hitSummary', () => {
  it('prefers the top-level engagement summary', () => {
    expect(hitSummary({ status: 'ok', summary: 'top', artifact_ref: { summary: 'artefact' } as never })).toBe('top');
  });
  it('falls back to the artefact preview for legacy rows', () => {
    expect(hitSummary({ status: 'ok', artifact_ref: { summary: 'artefact' } as never })).toBe('artefact');
  });
  it('says "skipped" rather than "no summary" for a skipped run', () => {
    expect(hitSummary({ status: 'skipped' })).toBe('skipped');
  });
});

describe('AgentRecall page', () => {
  it('recalls scoped to the slug in the route and renders the AC fields', async () => {
    (fetchAgentRecall as Mock).mockResolvedValue([HIT]);
    renderPage();
    await submit('cfn-lint gate');

    await waitFor(() => expect(fetchAgentRecall).toHaveBeenCalledTimes(1));
    expect(fetchAgentRecall).toHaveBeenCalledWith('ren', 'cfn-lint gate', 10);

    expect(await screen.findByText('issue-implement')).toBeInTheDocument();
    expect(screen.getByText(HIT.started_at)).toBeInTheDocument();
    expect(screen.getByText(/Opened draft PR 547/)).toBeInTheDocument();
    expect(screen.getByText(/SCORE 0\.812/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /artefact/i })).toHaveAttribute('href', HIT.artifact_ref.uri);
  });

  it('passes the operator-chosen k through', async () => {
    (fetchAgentRecall as Mock).mockResolvedValue([]);
    renderPage();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } });
    await submit('anything');
    await waitFor(() => expect(fetchAgentRecall).toHaveBeenCalledWith('ren', 'anything', 3));
  });

  it('never fires a request for a blank query', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/what did I conclude/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /recall/i }));
    expect(fetchAgentRecall).not.toHaveBeenCalled();
  });

  it('surfaces a failed recall instead of an empty result list (C-4)', async () => {
    (fetchAgentRecall as Mock).mockRejectedValue(new Error('agents-api 500'));
    renderPage();
    await submit('boom');
    expect(await screen.findByText(/recall failed — agents-api 500/)).toBeInTheDocument();
    expect(screen.queryByText(/no embedded executions matched/)).not.toBeInTheDocument();
  });

  it('explains an empty hit list rather than showing a bare zero', async () => {
    (fetchAgentRecall as Mock).mockResolvedValue([]);
    renderPage();
    await submit('nothing like this');
    expect(await screen.findByText(/no embedded executions matched/)).toBeInTheDocument();
  });
});
