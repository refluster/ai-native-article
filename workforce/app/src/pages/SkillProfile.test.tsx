import { describe, it, expect } from 'vitest';
import { archiveConfirmMessage, splitFrontmatter } from './SkillProfile';

describe('splitFrontmatter', () => {
  // Regression: a SKILL.md frontmatter block used to reach react-markdown
  // verbatim, where the closing `---` became a setext heading underline and
  // collapsed name + description into one giant bold line. The block must be
  // lifted out as key/value pairs, leaving only the real body to render.
  it('lifts a name/description frontmatter block out of the body', () => {
    const src = [
      '---',
      'name: pr-review',
      'description: Workforce skill that applies the lens. Uses `config.checklist_sections`.',
      '---',
      '',
      '# pr-review',
      '',
      'Lambda-resident implementation.',
    ].join('\n');

    const { frontmatter, body } = splitFrontmatter(src);

    expect(frontmatter).toEqual([
      ['name', 'pr-review'],
      ['description', 'Workforce skill that applies the lens. Uses `config.checklist_sections`.'],
    ]);
    // The `---` delimiters and the key/value lines are gone from the body…
    expect(body).not.toContain('---');
    expect(body).not.toContain('name: pr-review');
    // …but the real markdown body is preserved intact.
    expect(body).toContain('# pr-review');
    expect(body).toContain('Lambda-resident implementation.');
  });

  it('returns the whole source as body when there is no frontmatter', () => {
    const src = '# Just a heading\n\nSome prose.';
    const { frontmatter, body } = splitFrontmatter(src);
    expect(frontmatter).toBeNull();
    expect(body).toBe(src);
  });

  it('strips surrounding quotes and folds wrapped continuation lines', () => {
    const src = [
      '---',
      'name: "quoted-name"',
      'description: first part',
      '  second part',
      '---',
      'body',
    ].join('\n');

    const { frontmatter } = splitFrontmatter(src);
    expect(frontmatter).toEqual([
      ['name', 'quoted-name'],
      ['description', 'first part second part'],
    ]);
  });

  it('does not treat a horizontal rule mid-document as frontmatter', () => {
    const src = '# Title\n\nIntro.\n\n---\n\nAfter the rule.';
    const { frontmatter, body } = splitFrontmatter(src);
    expect(frontmatter).toBeNull();
    expect(body).toBe(src);
  });
});

describe('archiveConfirmMessage', () => {
  // ADR-0017: archive hides the skill from the default list but existing
  // bindings keep firing. The dialog must break the "archive = stopped"
  // mental model by naming the agents that will keep running it.
  it('warns with the bound-agent count and slugs when agents are still bound', () => {
    const msg = archiveConfirmMessage('feed-post', ['elena', 'dario']);
    expect(msg).toContain('Archive skill "feed-post"?');
    expect(msg).toContain('Still bound to 2 agents (elena, dario)');
    expect(msg).toContain('archiving does NOT stop execution');
    expect(msg).toContain('Unbind to stop the runs.');
  });

  it('uses the singular form for one bound agent', () => {
    const msg = archiveConfirmMessage('pr-autopilot', ['nadia']);
    expect(msg).toContain('Still bound to 1 agent (nadia)');
  });

  it('states explicitly when nothing is bound', () => {
    const msg = archiveConfirmMessage('orphan-skill', []);
    expect(msg).toContain('No agents are currently bound to this skill.');
    expect(msg).not.toContain('Still bound');
  });
});
