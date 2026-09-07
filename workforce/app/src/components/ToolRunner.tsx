// Schema-driven run panel for one tool (ADR-0027 §3, Epic-025 Phase 2).
//
// The form comes from the tool's `input` JSON Schema and the result view
// from its `output` schema, so a sixth tool ships by committing a
// registry entry — no component here changes. That is the whole claim of
// the declarative registry, and this file is where it is either true or
// not.
//
// Two deliberate narrownesses:
//
//   - Only a flat object of string / integer / number / boolean fields
//     renders, which is exactly what validate-tools.mjs permits a tool to
//     declare. The schema stays small so this stays small; a richer form
//     language would be a second UI framework with its own drift.
//   - The result renderer walks the returned VALUE, using the output
//     schema only for labels. A model that returns a field the schema did
//     not declare still shows it, rather than silently hiding data the
//     operator paid for.

import { useMemo, useState } from 'react';
import Typeplate from './Typeplate';
import { runTool, toolsApiConfigured } from '../lib/tools';
import type { ToolDefinition, ToolRunResult } from '../types/tool';

interface Props {
  projectId: string;
  tool: ToolDefinition;
}

/** One renderable form field, flattened out of the input schema. */
interface Field {
  name: string;
  label: string;
  description?: string;
  type: 'string' | 'integer' | 'number' | 'boolean';
  enum?: string[];
  default?: unknown;
  maxLength?: number;
  required: boolean;
  /** Long free text gets a textarea; a bounded string gets an input. */
  multiline: boolean;
}

const MULTILINE_MIN_LENGTH = 500;

export function fieldsOf(tool: ToolDefinition): Field[] {
  const schema = tool.input as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, raw]) => {
    const type = (raw.type as Field['type']) ?? 'string';
    const maxLength = typeof raw.maxLength === 'number' ? raw.maxLength : undefined;
    return {
      name,
      label: (raw.title as string) ?? name,
      description: raw.description as string | undefined,
      type,
      enum: Array.isArray(raw.enum) ? (raw.enum as string[]) : undefined,
      default: raw.default,
      maxLength,
      required: required.has(name),
      multiline: type === 'string' && !raw.enum && (maxLength ?? 0) >= MULTILINE_MIN_LENGTH,
    };
  });
}

function initialValues(fields: Field[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) out[f.name] = f.default === undefined ? '' : String(f.default);
  return out;
}

/**
 * Convert the form's string state into the typed shape the tool declared.
 * Empty optional fields are omitted rather than sent as "", which would
 * fail the server's type check for a non-string field.
 */
export function coerceValues(
  fields: Field[],
  values: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.name];
    if (raw === undefined || raw.trim() === '') continue;
    if (f.type === 'integer' || f.type === 'number') {
      const n = Number(raw);
      out[f.name] = Number.isNaN(n) ? raw : n;
    } else if (f.type === 'boolean') {
      out[f.name] = raw === 'true';
    } else {
      out[f.name] = raw;
    }
  }
  return out;
}

export default function ToolRunner({ projectId, tool }: Props) {
  const fields = useMemo(() => fieldsOf(tool), [tool]);
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(fields));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const missingRequired = fields.filter((f) => f.required && !values[f.name]?.trim());
  const canRun = toolsApiConfigured() && !running && missingRequired.length === 0;

  async function onRun() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await runTool(projectId, tool.tool_id, coerceValues(fields, values)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canRun) void onRun();
        }}
      >
        {fields.map((field) => (
          <FormField
            key={field.name}
            field={field}
            value={values[field.name] ?? ''}
            onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
          />
        ))}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="submit"
            disabled={!canRun}
            className="font-wfmono text-[11px] uppercase tracking-[0.14em] px-4 py-2 border border-wf-outline-variant bg-wf-surface-container text-wf-on-surface hover:border-wf-on-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {running ? 'Running…' : 'Run'}
          </button>
          {!toolsApiConfigured() && (
            <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
              Runs not configured in this build
            </span>
          )}
          {toolsApiConfigured() && missingRequired.length > 0 && (
            <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
              {missingRequired.map((f) => f.label).join(', ')} required
            </span>
          )}
        </div>
      </form>

      {error && <RunError message={error} />}
      {result && <RunResult tool={tool} result={result} />}
    </div>
  );
}

function FormField({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `tool-field-${field.name}`;
  const describedBy = field.description ? `${id}-desc` : undefined;
  const common =
    'w-full bg-wf-surface border border-wf-outline-variant rounded-wf-md px-3 py-2 text-sm text-wf-on-surface focus:outline-none focus:border-wf-on-surface';

  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="block font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant"
      >
        {field.label}
        {field.required && <span className="text-wf-tertiary"> *</span>}
      </label>
      {field.description && (
        <p id={describedBy} className="text-xs text-wf-on-surface-variant leading-relaxed">
          {field.description}
        </p>
      )}
      {field.enum ? (
        <select
          id={id}
          aria-describedby={describedBy}
          className={common}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {!field.default && <option value="">—</option>}
          {field.enum.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : field.multiline ? (
        <textarea
          id={id}
          aria-describedby={describedBy}
          rows={5}
          maxLength={field.maxLength}
          className={`${common} resize-y`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          aria-describedby={describedBy}
          type={field.type === 'string' ? 'text' : 'number'}
          maxLength={field.maxLength}
          className={common}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function RunError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-3"
    >
      <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
        Run failed
      </p>
      {/* The server's detail is shown verbatim: a truncated completion, an
          unprovisioned deployment and a budget refusal are each actionable,
          and collapsing them into "something went wrong" is what made the
          original mini-apps hard to operate. */}
      <p className="mt-2 text-sm text-wf-on-surface-variant leading-relaxed break-words">
        {message}
      </p>
    </div>
  );
}

function RunResult({ tool, result }: { tool: ToolDefinition; result: ToolRunResult }) {
  const labels = useMemo(() => {
    const props = (tool.output as { properties?: Record<string, Record<string, unknown>> })
      .properties;
    const out: Record<string, string> = {};
    for (const [name, raw] of Object.entries(props ?? {})) {
      out[name] = (raw.title as string) ?? humanise(name);
    }
    return out;
  }, [tool]);

  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <Typeplate label="RESULT" value={`${tool.tool_id} v${tool.version}`} />
        <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          {result.usage.tokens_out} out · {result.usage.deployment}
        </span>
      </div>
      <div className="p-4">
        <Value value={result.data} labels={labels} depth={0} />
      </div>
    </section>
  );
}

/**
 * Render whatever came back. Walks the value rather than the schema so a
 * field the model added is shown, not swallowed — the operator paid for
 * those tokens.
 */
function Value({
  value,
  labels,
  depth,
}: {
  value: unknown;
  labels: Record<string, string>;
  depth: number;
}) {
  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    return (
      <ol className="space-y-3">
        {value.map((item, i) => (
          <li
            key={i}
            className={
              typeof item === 'object' && item !== null
                ? 'border border-wf-outline-variant rounded-wf-md p-3'
                : 'text-sm text-wf-on-surface leading-relaxed'
            }
          >
            <Value value={item} labels={labels} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }

  if (typeof value === 'object') {
    return (
      <dl className="space-y-3">
        {Object.entries(value as Record<string, unknown>).map(([key, v]) => (
          <div key={key}>
            <dt className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
              {labels[key] ?? humanise(key)}
            </dt>
            <dd className="mt-1">
              <Value value={v} labels={labels} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <p className="text-sm text-wf-on-surface leading-relaxed whitespace-pre-wrap">
      {String(value)}
    </p>
  );
}

/** `why_it_matters` → `Why it matters`. */
export function humanise(key: string): string {
  const spaced = key.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
