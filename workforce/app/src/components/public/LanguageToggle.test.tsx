// The JA / EN pill is shared by Research and Docs; its accessible name is
// what tells them apart, and Research's must stay "Article edition".

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LanguageToggle from './LanguageToggle';

describe('LanguageToggle', () => {
  it('is named "Article edition" unless a surface says otherwise', () => {
    render(
      <MemoryRouter>
        <LanguageToggle value="ja" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('group', { name: 'Article edition' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'JA' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('takes the Docs surface name', () => {
    render(
      <MemoryRouter>
        <LanguageToggle value="en" label="Document edition" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('group', { name: 'Document edition' })).toBeInTheDocument();
  });
});
