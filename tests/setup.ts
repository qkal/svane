import { vi } from 'vitest';
// @testing-library/dom's waitFor needs jest global to detect fake timers
// @ts-expect-error jest compat shim for @testing-library/dom
globalThis.jest = vi;
