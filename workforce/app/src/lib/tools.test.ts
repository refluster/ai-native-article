// Registry lookup + credential gating for the project Tools surface.
//
// Phase 1 ships an empty registry, so these tests build their own
// ToolDefinition fixtures rather than asserting on TOOL_REGISTRY's
// contents — the behaviour under test is the gating, which must already
// be correct when the first real tool lands in Phase 2.

import { describe, it, expect } from 'vitest';
import { TOOL_REGISTRY, findTool, missingCredentials } from './tools';
import type { ToolDefinition } from '../types/tool';
import type { CredentialMetadata } from '../types/project';

const tool = (over: Partial<ToolDefinition> = {}): ToolDefinition => ({
  tool_id: 'problem-finding',
  display_name: 'Problem Finding',
  summary: 'Decompose an objective into candidate problems.',
  version: '1.0.0',
  requires: ['azure.openai'],
  input: {},
  output: {},
  ...over,
});

const cred = (credential_type: string): CredentialMetadata => ({
  credential_type,
  name: `wf/projects/asp-cloud/${credential_type}`,
  secret_arn: `arn:aws:secretsmanager:us-west-2:1:secret:${credential_type}`,
});

describe('TOOL_REGISTRY', () => {
  it('is empty until Phase 2 populates it', () => {
    expect(TOOL_REGISTRY).toEqual([]);
  });

  it('has no duplicate tool ids', () => {
    const ids = TOOL_REGISTRY.map((t) => t.tool_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('findTool', () => {
  it('returns undefined for an unregistered id', () => {
    expect(findTool('problem-finding')).toBeUndefined();
  });
});

describe('missingCredentials', () => {
  it('reports nothing when every requirement is provisioned', () => {
    expect(missingCredentials(tool(), [cred('azure.openai')])).toEqual([]);
  });

  it('reports the unprovisioned requirements', () => {
    const t = tool({ requires: ['azure.openai', 'notion.integration_token'] });
    expect(missingCredentials(t, [cred('azure.openai')])).toEqual([
      'notion.integration_token',
    ]);
  });

  it('reports every requirement when the project has no credentials', () => {
    expect(missingCredentials(tool(), [])).toEqual(['azure.openai']);
  });

  it('ignores credentials the tool does not require', () => {
    expect(missingCredentials(tool(), [cred('azure.openai'), cred('github.token')])).toEqual(
      [],
    );
  });

  it('does not let a variant satisfy its base type', () => {
    // A variant lives at its own Secrets Manager path, so it is a
    // different secret — treating it as the base type would gate a run
    // open that the injector will then fail to resolve.
    const t = tool({ requires: ['notion.integration_token'] });
    expect(missingCredentials(t, [cred('notion.integration_token@tools')])).toEqual([
      'notion.integration_token',
    ]);
  });

  it('reports nothing for a tool that needs no credentials', () => {
    expect(missingCredentials(tool({ requires: [] }), [])).toEqual([]);
  });
});
