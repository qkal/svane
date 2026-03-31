import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ['browser'],
  },
  test: {
    setupFiles: ['./tests/setup.ts'],
    environmentMatchGlobs: [
      ['tests/svelte/**', 'jsdom'],
      ['tests/core/query.test.ts', 'jsdom'],
    ],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.svelte.ts'],
  },
});