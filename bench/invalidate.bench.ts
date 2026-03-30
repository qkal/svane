import { bench } from 'vitest';
import { CacheStore } from '../src/core/cache';

const NUM_ENTRIES = 10000;
const NUM_INVALIDATIONS = 100;

bench('invalidate cache', () => {
  const store = new CacheStore({ gcTime: 300_000 });

  // Fill cache
  for (let i = 0; i < NUM_ENTRIES; i++) {
    const key = JSON.stringify(['todos', i % 100, { id: i }]);
    store.set(key, { data: { val: i }, timestamp: Date.now(), error: null });
  }

  // Run invalidations
  for (let i = 0; i < NUM_INVALIDATIONS; i++) {
    const prefix = JSON.stringify(['todos', i % 100]);
    store.invalidate(prefix);
  }
});