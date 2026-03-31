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
      const store = new CacheStore({ gcTime: 300_000 });
      expect(store.get('["todos"]')).toBeUndefined();
    });

    it('returns entry after set', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      const entry = makeEntry([1, 2, 3]);
      store.set('["todos"]', entry);
      expect(store.get('["todos"]')).toEqual(entry);
    });

    it('overwrites existing entry on set', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      store.set('["todos"]', makeEntry('first'));
      store.set('["todos"]', makeEntry('second'));
      expect(store.get('["todos"]')?.data).toBe('second');
    });
  });

  describe('isStale', () => {
    it('returns false immediately after set', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      store.set('["todos"]', makeEntry([]));
      expect(store.isStale('["todos"]', 30_000)).toBe(false);
    });

    it('returns false just before staleTime elapses', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      store.set('["todos"]', makeEntry([]));
      vi.advanceTimersByTime(29_999);
      expect(store.isStale('["todos"]', 30_000)).toBe(false);
    });

    it('returns true after staleTime elapses', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      store.set('["todos"]', makeEntry([]));
      vi.advanceTimersByTime(30_001);
      expect(store.isStale('["todos"]', 30_000)).toBe(true);
    });

    it('returns true for unknown key', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      expect(store.isStale('["missing"]', 30_000)).toBe(true);
    });
  });

  describe('subscribe / notify', () => {
    it('calls subscriber when key is set', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      const cb = vi.fn();
      store.subscribe('["todos"]', cb);
      store.set('["todos"]', makeEntry([]));
      expect(cb).toHaveBeenCalledOnce();
    });

    it('calls multiple subscribers for the same key', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      store.subscribe('["todos"]', cb1);
      store.subscribe('["todos"]', cb2);
      store.set('["todos"]', makeEntry([]));
      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });

    it('does not call subscriber after unsubscribe', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      const cb = vi.fn();
      const unsubscribe = store.subscribe('["todos"]', cb);
      unsubscribe();
      store.set('["todos"]', makeEntry([]));
      expect(cb).not.toHaveBeenCalled();
    });

    it('calls subscriber when key is deleted', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      const cb = vi.fn();
      store.set('["todos"]', makeEntry([]));
      store.subscribe('["todos"]', cb);
      store.delete('["todos"]');
      expect(cb).toHaveBeenCalledOnce();
    });

    it('calls all subscribers on clear', () => {
      const store = new CacheStore({ gcTime: 300_000 });
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
      const store = new CacheStore({ gcTime: 300_000 });
      const cb = vi.fn();
      store.subscribe('["todos"]', cb);
      store.set('["posts"]', makeEntry([]));
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('delete / clear', () => {
    it('removes entry on delete', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      store.set('["todos"]', makeEntry([]));
      store.delete('["todos"]');
      expect(store.get('["todos"]')).toBeUndefined();
    });

    it('is a no-op delete for unknown key', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      expect(() => store.delete('["missing"]')).not.toThrow();
    });

    it('removes all entries on clear', () => {
      const store = new CacheStore({ gcTime: 300_000 });
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
      const store = new CacheStore({ persist: storage, gcTime: 300_000 });
      store.set('["todos"]', makeEntry([1]));
      expect(storage.getItem('kvale-cache')).not.toBeNull();
    });

    it('hydrates entries from storage on construction', () => {
      const storage = makeMockStorage();
      const entry = makeEntry([1, 2]);
      const first = new CacheStore({ persist: storage, gcTime: 300_000 });
      first.set('["todos"]', entry);

      const second = new CacheStore({ persist: storage, gcTime: 300_000 });
      expect(second.get('["todos"]')).toEqual(entry);
    });

    it('does not persist when no storage configured', () => {
      // Should not throw — just skips persistence
      const store = new CacheStore({ gcTime: 300_000 });
      expect(() => store.set('["todos"]', makeEntry([]))).not.toThrow();
    });
  });

  describe('in-flight deduplication', () => {
    it('getInFlight returns undefined when no request is in flight', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      expect(store.getInFlight('["todos"]')).toBeUndefined();
    });

    it('getInFlight returns the promise after setInFlight', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      const p = Promise.resolve();
      store.setInFlight('["todos"]', p, new AbortController());
      expect(store.getInFlight('["todos"]')).toBe(p);
    });

    it('clearInFlight removes the promise', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      store.setInFlight('["todos"]', Promise.resolve(), new AbortController());
      store.clearInFlight('["todos"]');
      expect(store.getInFlight('["todos"]')).toBeUndefined();
    });
  });

  describe('cancelQuery', () => {
    it('aborts the AbortController registered for a key', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      const controller = new AbortController();
      store.setInFlight('["todos"]', Promise.resolve(), controller);
      expect(controller.signal.aborted).toBe(false);
      store.cancelQuery('["todos"]');
      expect(controller.signal.aborted).toBe(true);
    });

    it('is a no-op when no request is in flight', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      expect(() => store.cancelQuery('["todos"]')).not.toThrow();
    });
  });

  describe('getQueryData / setQueryData', () => {
    it('getQueryData returns undefined on miss', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      expect(store.getQueryData('["todos"]')).toBeUndefined();
    });

    it('getQueryData returns data after set', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      store.set('["todos"]', makeEntry([1, 2, 3]));
      expect(store.getQueryData('["todos"]')).toEqual([1, 2, 3]);
    });

    it('setQueryData with direct value creates entry and notifies', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      const cb = vi.fn();
      store.subscribe('["todos"]', cb);
      store.setQueryData('["todos"]', [4, 5, 6]);
      expect(store.getQueryData('["todos"]')).toEqual([4, 5, 6]);
      expect(cb).toHaveBeenCalledOnce();
    });

    it('setQueryData with updater function receives previous value', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      store.set('["todos"]', makeEntry([1, 2]));
      store.setQueryData<number[]>('["todos"]', (prev) => [...(prev ?? []), 3]);
      expect(store.getQueryData('["todos"]')).toEqual([1, 2, 3]);
    });

    it('setQueryData with updater receives undefined when key is missing', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      let received: unknown[] | undefined = [99];
      store.setQueryData<unknown[]>('["todos"]', (prev) => {
        received = prev;
        return [];
      });
      expect(received).toBeUndefined();
    });
  });

  describe('invalidate', () => {
    it('marks exact key as stale', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      store.set('["todos"]', makeEntry([1, 2]));
      expect(store.isStale('["todos"]', 30_000)).toBe(false);
      store.invalidate('["todos"]');
      expect(store.isStale('["todos"]', 30_000)).toBe(true);
    });

    it('marks child keys as stale via prefix matching', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      store.set('["todos",1]', makeEntry({ id: 1 }));
      store.set('["todos",2]', makeEntry({ id: 2 }));
      store.set('["posts"]', makeEntry([]));
      store.invalidate('["todos"]');
      expect(store.isStale('["todos",1]', 30_000)).toBe(true);
      expect(store.isStale('["todos",2]', 30_000)).toBe(true);
      expect(store.isStale('["posts"]', 30_000)).toBe(false);
    });

    it('notifies subscribers of invalidated keys', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      store.set('["todos",1]', makeEntry({ id: 1 }));
      const cb = vi.fn();
      store.subscribe('["todos",1]', cb);
      store.invalidate('["todos"]');
      expect(cb).toHaveBeenCalledOnce();
    });

    it('is a no-op for keys that do not exist', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      expect(() => store.invalidate('["missing"]')).not.toThrow();
    });
  });

  describe('entries', () => {
    it('yields all current entries', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      store.set('["a"]', makeEntry(1));
      store.set('["b"]', makeEntry(2));
      const result = [...store.entries()];
      expect(result).toHaveLength(2);
      expect(result.map(([k]) => k).sort()).toEqual(['["a"]', '["b"]']);
    });

    it('yields nothing when cache is empty', () => {
      const store = new CacheStore({ gcTime: 300_000 });
      expect([...store.entries()]).toHaveLength(0);
    });
  });

  describe('gcTime', () => {
    it('prunes entry after gcTime when no subscribers (via setQueryData)', () => {
      const store = new CacheStore({ gcTime: 5_000 });
      store.setQueryData('["todos"]', [1, 2, 3]);
      expect(store.get('["todos"]')).toBeDefined();
      vi.advanceTimersByTime(5_001);
      expect(store.get('["todos"]')).toBeUndefined();
    });

    it('does not prune entry while a runner is registered', () => {
      const store = new CacheStore({ gcTime: 5_000 });
      store.setQueryData('["todos"]', [1, 2, 3]);
      store.registerKey('["todos"]');
      vi.advanceTimersByTime(10_000);
      expect(store.get('["todos"]')).toBeDefined();
      store.unregisterKey('["todos"]');
    });

    it('prunes entry after gcTime once the last runner unregisters', () => {
      const store = new CacheStore({ gcTime: 5_000 });
      store.setQueryData('["todos"]', [1, 2]);
      store.registerKey('["todos"]');
      vi.advanceTimersByTime(4_000);
      store.unregisterKey('["todos"]');
      vi.advanceTimersByTime(5_001);
      expect(store.get('["todos"]')).toBeUndefined();
    });

    it('cancels gcTime timer when a new runner registers before expiry', () => {
      const store = new CacheStore({ gcTime: 5_000 });
      store.setQueryData('["todos"]', [1, 2]);
      vi.advanceTimersByTime(4_000);
      store.registerKey('["todos"]');
      vi.advanceTimersByTime(5_001);
      expect(store.get('["todos"]')).toBeDefined();
      store.unregisterKey('["todos"]');
    });

    it('prunes entry created via setQueryData with no active runners', () => {
      const store = new CacheStore({ gcTime: 5_000 });
      store.setQueryData('["todos"]', [1, 2]);
      vi.advanceTimersByTime(5_001);
      expect(store.get('["todos"]')).toBeUndefined();
    });
  });

  describe('onEvent', () => {
    it('fires set event when setQueryData is called', () => {
      const onEvent = vi.fn();
      const store = new CacheStore({ gcTime: 300_000, onEvent });
      store.setQueryData('["todos"]', [1, 2]);
      expect(onEvent).toHaveBeenCalledWith({ type: 'set', key: ['todos'] });
    });

    it('does not fire set event on internal set() calls', () => {
      const onEvent = vi.fn();
      const store = new CacheStore({ gcTime: 300_000, onEvent });
      store.set('["todos"]', { data: [1], timestamp: Date.now(), error: null });
      expect(onEvent).not.toHaveBeenCalled();
    });

    it('fires invalidate event with key and matchedKeys', () => {
      const onEvent = vi.fn();
      const store = new CacheStore({ gcTime: 300_000, onEvent });
      store.set('["todos",1]', { data: { id: 1 }, timestamp: Date.now(), error: null });
      store.set('["todos",2]', { data: { id: 2 }, timestamp: Date.now(), error: null });
      store.invalidate('["todos"]');
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'invalidate',
          key: ['todos'],
          matchedKeys: expect.arrayContaining([['todos', 1], ['todos', 2]]),
        }),
      );
    });

    it('does not fire invalidate event when no keys matched', () => {
      const onEvent = vi.fn();
      const store = new CacheStore({ gcTime: 300_000, onEvent });
      store.invalidate('["todos"]');
      expect(onEvent).not.toHaveBeenCalled();
    });

    it('fires gc event when entry is pruned by gcTime', () => {
      const onEvent = vi.fn();
      const store = new CacheStore({ gcTime: 5_000, onEvent });
      store.setQueryData('["todos"]', [1]);
      vi.advanceTimersByTime(5_001);
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'gc', key: ['todos'] }));
    });
  });
});
