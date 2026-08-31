// Registry lookup + credential gating for the project Tools surface.
//
// Phase 1 ships an empty registry, so these tests build their own
// ToolDefinition fixtures rather than asserting on TOOL_REGISTRY's
// contents — the behaviour under test is the gating, which must already
// be correct when the first real tool lands in Phase 2.

import { describe, it, expect } from 'vitest';
import {
  TOOL_REGISTRY,
  duplicateToolIds,
  findTool,
  unprovisionedOnProject,
} from './tools';
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

  it('carries no duplicate ids', () => {
    expect(duplicateToolIds()).toEqual([]);
  });
});

describe('findTool', () => {
  // Exercised against a real registry rather than the empty default:
  // asserting that an empty array finds nothing tests the literal, not
  // the lookup that Phase 2 will depend on.
  const registry = [tool(), tool({ tool_id: 'user-research' })];

  it('finds a registered tool by id', () => {
    expect(findTool('user-research', registry)?.tool_id).toBe('user-research');
  });

  it('returns undefined for an id that is not in the registry', () => {
    expect(findTool('insight-foundry', registry)).toBeUndefined();
  });

  it('does not match on display name or a partial id', () => {
    expect(findTool('Problem Finding', registry)).toBeUndefined();
    expect(findTool('problem', registry)).toBeUndefined();
  });

  it('defaults to the empty Phase-1 registry', () => {
    expect(findTool('problem-finding')).toBeUndefined();
  });
});

describe('duplicateToolIds', () => {
  it('names an id that appears twice', () => {
    expect(duplicateToolIds([tool(), tool()])).toEqual(['problem-finding']);
  });

  it('reports each duplicated id once, not once per repeat', () => {
    expect(duplicateToolIds([tool(), tool(), tool()])).toEqual(['problem-finding']);
  });

  it('is empty for a registry of distinct ids', () => {
    expect(duplicateToolIds([tool(), tool({ tool_id: 'user-research' })])).toEqual([]);
  });
});

describe('unprovisionedOnProject', () => {
  it('reports nothing when every requirement is provisioned on the project', () => {
    expect(unprovisionedOnProject(tool(), [cred('azure.openai')])).toEqual([]);
  });

  it('reports the unprovisioned requirements', () => {
    const t = tool({ requires: ['azure.openai', 'notion.integration_token'] });
    expect(unprovisionedOnProject(t, [cred('azure.openai')])).toEqual([
      'notion.integration_token',
    ]);
  });

  it('reports every requirement when the project has no credentials', () => {
    expect(unprovisionedOnProject(tool(), [])).toEqual(['azure.openai']);
  });

  it('ignores credentials the tool does not require', () => {
    expect(unprovisionedOnProject(tool(), [cred('azure.openai'), cred('github.token')])).toEqual(
      [],
    );
  });

  it('does not let a variant satisfy its base type', () => {
    // A variant lives at its own Secrets Manager path, so it is a
    // different secret — treating it as the base type would gate a run
    // open that the injector will then fail to resolve.
    const t = tool({ requires: ['notion.integration_token'] });
    expect(unprovisionedOnProject(t, [cred('notion.integration_token@tools')])).toEqual([
      'notion.integration_token',
    ]);
  });

  it('reports nothing for a tool that needs no credentials', () => {
    expect(unprovisionedOnProject(tool({ requires: [] }), [])).toEqual([]);
  });
});
