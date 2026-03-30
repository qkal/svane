import { CacheStore } from '../src/core/cache';

const NUM_ENTRIES = 10000;
const NUM_INVALIDATIONS = 100;

function bench() {
  const store = new CacheStore({ gcTime: 300_000 });

  // Fill cache
  for (let i = 0; i < NUM_ENTRIES; i++) {
    const key = JSON.stringify(['todos', i % 100, { id: i }]);
    store.set(key, { data: { val: i }, timestamp: Date.now(), error: null });
  }

  const start = performance.now();

  for (let i = 0; i < NUM_INVALIDATIONS; i++) {
    const prefix = JSON.stringify(['todos', i % 100]);
    store.invalidate(prefix);
  }

  const end = performance.now();
  console.log(`Time taken for ${NUM_INVALIDATIONS} invalidations with ${NUM_ENTRIES} entries: ${(end - start).toFixed(2)}ms`);
}

bench();
