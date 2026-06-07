// Vitest config for the workforce SPA. Mirrors the Vite config minus the
// build-only plugins; the React plugin is needed so JSX in test files
// transpiles via SWC the same way vite dev does.
//
// `globals: false` keeps the explicit `import { describe, it, expect }`
// boilerplate — it forces tests to read like normal modules and avoids
// dragging Jest-style ambient globals into the SPA's TS surface.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: false,
    css: false,
  },
});
