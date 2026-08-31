// Tests for the schema-driven run panel.
//
// The claim under test is ADR-0027 §3's: a tool ships by committing a
// registry entry, with no component change. So these drive the panel from
// AD-HOC schemas rather than from the shipped registry — if the form only
// works for the two tools that exist today, the claim is false and these
// are where that shows.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ToolRunner, { fieldsOf, coerceValues, humanise } from './ToolRunner';
import type { ToolDefinition } from '../types/tool';

vi.mock('../lib/tools', async () => {
  const actual = await vi.importActual<typeof import('../lib/tools')>('../lib/tools');
  return { ...actual, runTool: vi.fn(), toolsApiConfigured: vi.fn(() => true) };
});

import { runTool, toolsApiConfigured } from '../lib/tools';
const mockedRun = vi.mocked(runTool);
const mockedConfigured = vi.mocked(toolsApiConfigured);

const tool = (over: Partial<ToolDefinition> = {}): ToolDefinition => ({
  tool_id: 'demo',
  display_name: 'Demo',
  summary: 's',
  version: '1.0.0',
  requires: ['azure.openai'],
  model: { max_tokens: 1000 },
  input: {
    type: 'object',
    required: ['goal'],
    properties: {
      goal: { type: 'string', title: 'Goal', description: 'What you want', maxLength: 100 },
      notes: { type: 'string', title: 'Notes', maxLength: 2000 },
      mode: { type: 'string', title: 'Mode', enum: ['a', 'b'], default: 'a' },
      depth: { type: 'integer', title: 'Depth' },
    },
  },
  output: { type: 'object', properties: { headline: { type: 'string' } } },
  ...over,
});

const result = (data: unknown) => ({
  tool_id: 'demo',
  version: '1.0.0',
  exec_ulid: '01',
  data,
  usage: { tokens_in: 1, tokens_out: 2, cost_usd: 0, deployment: 'gpt-5.4' },
});

beforeEach(() => {
  mockedConfigured.mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('fieldsOf', () => {
  it('flattens the input schema in declaration order', () => {
    expect(fieldsOf(tool()).map((f) => f.name)).toEqual(['goal', 'notes', 'mode', 'depth']);
  });

  it('marks required fields from the schema', () => {
    const fields = fieldsOf(tool());
    expect(fields.find((f) => f.name === 'goal')?.required).toBe(true);
    expect(fields.find((f) => f.name === 'notes')?.required).toBe(false);
  });

  it('uses a textarea only for long free text', () => {
    const fields = fieldsOf(tool());
    // maxLength 100 is an input; 2000 is a textarea; an enum never is.
    expect(fields.find((f) => f.name === 'goal')?.multiline).toBe(false);
    expect(fields.find((f) => f.name === 'notes')?.multiline).toBe(true);
    expect(fields.find((f) => f.name === 'mode')?.multiline).toBe(false);
  });

  it('falls back to the field name when no title is given', () => {
    const t = tool({ input: { type: 'object', properties: { raw: { type: 'string' } } } });
    expect(fieldsOf(t)[0].label).toBe('raw');
  });
});

describe('coerceValues', () => {
  const fields = fieldsOf(tool());

  it('omits empty optional fields rather than sending ""', () => {
    // Sending "" for an integer field would fail the server's type check
    // on a field the operator never touched.
    expect(coerceValues(fields, { goal: 'g', notes: '', depth: '' })).toEqual({ goal: 'g' });
  });

  it('converts numeric fields to numbers', () => {
    expect(coerceValues(fields, { goal: 'g', depth: '3' })).toEqual({ goal: 'g', depth: 3 });
  });

  it('leaves an unparseable number as text so the server reports it', () => {
    expect(coerceValues(fields, { goal: 'g', depth: 'three' })).toMatchObject({ depth: 'three' });
  });

  it('trims nothing from a value the operator typed', () => {
    expect(coerceValues(fields, { goal: '  spaced  ' })).toEqual({ goal: '  spaced  ' });
  });
});

describe('humanise', () => {
  it('turns a schema key into a label', () => {
    expect(humanise('why_it_matters')).toBe('Why it matters');
  });
});

describe('ToolRunner', () => {
  it('renders a control per schema field, with the enum default preselected', () => {
    render(<ToolRunner projectId="p" tool={tool()} />);
    expect(screen.getByLabelText(/Goal/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Notes/)).toBeInTheDocument();
    expect((screen.getByLabelText(/Mode/) as HTMLSelectElement).value).toBe('a');
  });

  it('blocks the run until every required field is filled, and says which', () => {
    render(<ToolRunner projectId="p" tool={tool()} />);
    expect(screen.getByRole('button', { name: /Run/ })).toBeDisabled();
    expect(screen.getByText(/Goal required/)).toBeInTheDocument();
  });

  it('sends the coerced input to the tool it was given', async () => {
    mockedRun.mockResolvedValue(result({ headline: 'ok' }));
    const user = userEvent.setup();
    render(<ToolRunner projectId="self/ren" tool={tool()} />);
    await user.type(screen.getByLabelText(/Goal/), 'cut drop-off');
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(mockedRun).toHaveBeenCalledTimes(1));
    expect(mockedRun).toHaveBeenCalledWith('self/ren', 'demo', {
      goal: 'cut drop-off',
      mode: 'a',
    });
  });

  it('renders a nested result without a per-tool component', async () => {
    // The generality claim: arrays of objects render from the value, so a
    // tool whose output shape nobody anticipated still displays.
    mockedRun.mockResolvedValue(
      result({ problems: [{ statement: 'S1', confidence: 'low' }, { statement: 'S2' }] }),
    );
    const user = userEvent.setup();
    render(<ToolRunner projectId="p" tool={tool()} />);
    await user.type(screen.getByLabelText(/Goal/), 'g');
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByText('S1')).toBeInTheDocument());
    expect(screen.getByText('S2')).toBeInTheDocument();
    expect(screen.getByText('Problems')).toBeInTheDocument();
  });

  it('shows a field the output schema never declared', async () => {
    // Hiding it would discard tokens the operator already paid for.
    mockedRun.mockResolvedValue(result({ headline: 'h', surprise: 'kept' }));
    const user = userEvent.setup();
    render(<ToolRunner projectId="p" tool={tool()} />);
    await user.type(screen.getByLabelText(/Goal/), 'g');
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByText('kept')).toBeInTheDocument());
  });

  it('surfaces the server detail verbatim on failure', async () => {
    mockedRun.mockRejectedValue(new Error('tools-api 502 · tool_run_failed · finish_reason=length'));
    const user = userEvent.setup();
    render(<ToolRunner projectId="p" tool={tool()} />);
    await user.type(screen.getByLabelText(/Goal/), 'g');
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/finish_reason=length/));
  });

  it('clears a previous result when a new run starts', async () => {
    mockedRun.mockResolvedValueOnce(result({ headline: 'first' }));
    mockedRun.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(<ToolRunner projectId="p" tool={tool()} />);
    await user.type(screen.getByLabelText(/Goal/), 'g');
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Run/ }));
    // A stale result next to a fresh error would read as a success.
    await waitFor(() => expect(screen.queryByText('first')).not.toBeInTheDocument());
  });

  it('disables the run and says so when the build has no tools-api', () => {
    mockedConfigured.mockReturnValue(false);
    render(<ToolRunner projectId="p" tool={tool()} />);
    expect(screen.getByRole('button', { name: /Run/ })).toBeDisabled();
    expect(screen.getByText(/Runs not configured/)).toBeInTheDocument();
  });
});
