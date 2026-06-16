import { describe, it, expect } from 'vitest';
import { splitFrontmatter } from './SkillProfile';

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
