import { act, cleanup, setup } from '@testing-library/svelte';
import { beforeEach, vi } from 'vitest';

// @testing-library/dom's waitFor needs jest global to detect fake timers
// @ts-expect-error jest compat shim for @testing-library/dom
globalThis.jest = vi;

// Inline of @testing-library/svelte/vitest — avoids Vite cross-root resolution
// issues when running tests from a nested git worktree.
beforeEach(() => {
  setup();
  return async () => {
    await act();
    cleanup();
  };
});
