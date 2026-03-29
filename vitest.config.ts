import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: !process.env.VITEST })],
  resolve: {
    conditions: ['browser'],
  },
  test: {
    setupFiles: ['./tests/setup.ts', '@testing-library/svelte/vitest'],
    environmentMatchGlobs: [
      ['tests/svelte/**', 'jsdom'],
      ['tests/core/query.test.ts', 'jsdom'],
    ],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.svelte.ts'],
  },
});
