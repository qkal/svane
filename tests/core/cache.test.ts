import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheStore } from '../../src/core/cache';
import type { CacheEntry } from '../../src/core/types';

function makeEntry(data: unknown, timestamp = Date.now()): CacheEntry {
  return { data, timestamp, error: null };
}

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

describe('CacheStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('get / set', () => {
    it('returns undefined for unknown key', () => {
      const store = new CacheStore({});
      expect(store.get('["todos"]')).toBeUndefined();
    });

    it('returns entry after set', () => {
      const store = new CacheStore({});
      const entry = makeEntry([1, 2, 3]);
      store.set('["todos"]', entry);
      expect(store.get('["todos"]')).toEqual(entry);
    });

    it('overwrites existing entry on set', () => {
      const store = new CacheStore({});
      store.set('["todos"]', makeEntry('first'));
      store.set('["todos"]', makeEntry('second'));
      expect(store.get('["todos"]')?.data).toBe('second');
    });
  });

  describe('isStale', () => {
    it('returns false immediately after set', () => {
      const store = new CacheStore({});
      store.set('["todos"]', makeEntry([]));
      expect(store.isStale('["todos"]', 30_000)).toBe(false);
    });

    it('returns false just before staleTime elapses', () => {
      const store = new CacheStore({});
      store.set('["todos"]', makeEntry([]));
      vi.advanceTimersByTime(29_999);
      expect(store.isStale('["todos"]', 30_000)).toBe(false);
    });

    it('returns true after staleTime elapses', () => {
      const store = new CacheStore({});
      store.set('["todos"]', makeEntry([]));
      vi.advanceTimersByTime(30_001);
      expect(store.isStale('["todos"]', 30_000)).toBe(true);
    });

    it('returns true for unknown key', () => {
      const store = new CacheStore({});
      expect(store.isStale('["missing"]', 30_000)).toBe(true);
    });
  });

  describe('subscribe / notify', () => {
    it('calls subscriber when key is set', () => {
      const store = new CacheStore({});
      const cb = vi.fn();
      store.subscribe('["todos"]', cb);
      store.set('["todos"]', makeEntry([]));
      expect(cb).toHaveBeenCalledOnce();
    });

    it('calls multiple subscribers for the same key', () => {
      const store = new CacheStore({});
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      store.subscribe('["todos"]', cb1);
      store.subscribe('["todos"]', cb2);
      store.set('["todos"]', makeEntry([]));
      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });

    it('does not call subscriber after unsubscribe', () => {
      const store = new CacheStore({});
      const cb = vi.fn();
      const unsubscribe = store.subscribe('["todos"]', cb);
      unsubscribe();
      store.set('["todos"]', makeEntry([]));
      expect(cb).not.toHaveBeenCalled();
    });

    it('calls subscriber when key is deleted', () => {
      const store = new CacheStore({});
      const cb = vi.fn();
      store.set('["todos"]', makeEntry([]));
      store.subscribe('["todos"]', cb);
      store.delete('["todos"]');
      expect(cb).toHaveBeenCalledOnce();
    });

    it('calls all subscribers on clear', () => {
      const store = new CacheStore({});
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      store.set('["todos"]', makeEntry([]));
      store.set('["posts"]', makeEntry([]));
      store.subscribe('["todos"]', cb1);
      store.subscribe('["posts"]', cb2);
      store.clear();
      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });

    it('does not call subscriber for a different key', () => {
      const store = new CacheStore({});
      const cb = vi.fn();
      store.subscribe('["todos"]', cb);
      store.set('["posts"]', makeEntry([]));
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('delete / clear', () => {
    it('removes entry on delete', () => {
      const store = new CacheStore({});
      store.set('["todos"]', makeEntry([]));
      store.delete('["todos"]');
      expect(store.get('["todos"]')).toBeUndefined();
    });

    it('is a no-op delete for unknown key', () => {
      const store = new CacheStore({});
      expect(() => store.delete('["missing"]')).not.toThrow();
    });

    it('removes all entries on clear', () => {
      const store = new CacheStore({});
      store.set('["todos"]', makeEntry([]));
      store.set('["posts"]', makeEntry([]));
      store.clear();
      expect(store.get('["todos"]')).toBeUndefined();
      expect(store.get('["posts"]')).toBeUndefined();
    });
  });

  describe('persistence', () => {
    it('persists entry to storage on set', () => {
      const storage = makeMockStorage();
      const store = new CacheStore({ persist: storage });
      store.set('["todos"]', makeEntry([1]));
      expect(storage.getItem('quelt-cache')).not.toBeNull();
    });

    it('hydrates entries from storage on construction', () => {
      const storage = makeMockStorage();
      const entry = makeEntry([1, 2]);
      const first = new CacheStore({ persist: storage });
      first.set('["todos"]', entry);

      const second = new CacheStore({ persist: storage });
      expect(second.get('["todos"]')).toEqual(entry);
    });

    it('does not persist when no storage configured', () => {
      // Should not throw — just skips persistence
      const store = new CacheStore({});
      expect(() => store.set('["todos"]', makeEntry([]))).not.toThrow();
    });
  });
});
