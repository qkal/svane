import { beforeEach, describe, expect, it } from 'vitest';
import { hydrateCache, persistCache } from '../../src/core/storage';
import type { CacheEntry } from '../../src/core/types';

function makeMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
}

describe('persistCache + hydrateCache', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = makeMockStorage();
  });

  it('round-trips a single cache entry', () => {
    const entry: CacheEntry = { data: { id: 1, title: 'Buy milk' }, timestamp: 1000, error: null };
    const entries = new Map([['["todos"]', entry]]);

    persistCache(storage, entries);
    const result = hydrateCache(storage);

    expect(result.get('["todos"]')).toEqual(entry);
  });

  it('round-trips multiple entries', () => {
    const entries = new Map<string, CacheEntry>([
      ['["todos"]', { data: [1, 2], timestamp: 1000, error: null }],
      ['["user"]', { data: { name: 'Kal' }, timestamp: 2000, error: null }],
    ]);

    persistCache(storage, entries);
    const result = hydrateCache(storage);

    expect(result.size).toBe(2);
    expect(result.get('["user"]')?.data).toEqual({ name: 'Kal' });
  });

  it('returns empty Map when storage is empty', () => {
    expect(hydrateCache(storage).size).toBe(0);
  });

  it('returns empty Map when storage contains corrupted JSON', () => {
    storage.setItem('quelt-cache', 'not valid json {{{');
    expect(hydrateCache(storage).size).toBe(0);
  });

  it('returns empty Map when storage contains null JSON value', () => {
    storage.setItem('quelt-cache', 'null');
    expect(hydrateCache(storage).size).toBe(0);
  });

  it('silently swallows persistCache write errors', () => {
    const brokenStorage = {
      ...makeMockStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => persistCache(brokenStorage as Storage, new Map())).not.toThrow();
  });
});
