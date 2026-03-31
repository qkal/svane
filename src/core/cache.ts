import { matchesKey } from './key';
import { hydrateCache, persistCache } from './storage';
import type { CacheConfig, CacheEntry, CacheEvent } from './types';

type CacheSubscriber = () => void;

/**
 * In-memory cache store. Manages entries, staleness, subscriber notifications,
 * optional localStorage persistence, request deduplication, and gcTime cleanup.
 *
 * @example
 * const store = new CacheStore({ persist: localStorage, gcTime: 300_000 });
 * store.set('["todos"]', { data: [], timestamp: Date.now(), error: null });
 * store.isStale('["todos"]', 30_000); // false immediately after set
 */
export class CacheStore {
  private readonly cache: Map<string, CacheEntry>;
  private readonly keyArrays: Map<string, unknown[]> = new Map();
  private readonly subscribers: Map<string, Set<CacheSubscriber>> = new Map();
  private readonly config: Pick<CacheConfig, 'persist' | 'gcTime' | 'onEvent'>;

  // In-flight deduplication
  private readonly inFlight: Map<string, Promise<unknown>> = new Map();
  private readonly inFlightControllers: Map<string, AbortController> = new Map();

  // gcTime: tracks active runner count per key and pending cleanup timers
  private readonly keyRefs: Map<string, number> = new Map();
  private readonly gcTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(config: Pick<CacheConfig, 'persist' | 'gcTime' | 'onEvent'>) {
    this.config = config;
    this.cache = config.persist ? hydrateCache(config.persist) : new Map();
    // keyArrays is populated lazily: via set() for new keys, and on first
    // invalidate() call for keys that were hydrated from persisted storage.
  }

  /** Returns the cached entry for `key`, or `undefined` if not present. */
  get(key: string): CacheEntry | undefined {
    return this.cache.get(key);
  }

  /** Stores `entry` under `key`, persists to storage (if configured), and notifies subscribers. */
  set(key: string, entry: CacheEntry): void {
    if (!this.keyArrays.has(key)) {
      const parsed = JSON.parse(key) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error(`Cache key must serialize to an array, got: ${key}`);
      }
      this.keyArrays.set(key, parsed);
    }
    this.cache.set(key, entry);
    if (this.config.persist) {
      persistCache(this.config.persist, this.cache);
    }
    this.notify(key);
  }

  /**
   * Returns true if the entry for `key` is older than `staleTime` ms,
   * or if no entry exists.
   */
  isStale(key: string, staleTime: number): boolean {
    const entry = this.cache.get(key);
    if (!entry) return true;
    return Date.now() - entry.timestamp > staleTime;
  }

  /** Removes the entry for `key` and notifies subscribers. No-op if key does not exist. */
  delete(key: string): void {
    this.cache.delete(key);
    this.keyArrays.delete(key);
    if (this.config.persist) {
      persistCache(this.config.persist, this.cache);
    }
    this.notify(key);
  }

  /** Removes all entries and notifies all subscribers. */
  clear(): void {
    const keys = [...this.cache.keys()];
    this.cache.clear();
    this.keyArrays.clear();
    if (this.config.persist) {
      persistCache(this.config.persist, this.cache);
    }
    for (const key of keys) this.notify(key);
  }

  /**
   * Subscribe to changes for a specific cache key.
   * Returns an unsubscribe function.
   */
  subscribe(key: string, callback: CacheSubscriber): () => void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)?.add(callback);
    return () => {
      const subs = this.subscribers.get(key);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscribers.delete(key);
        }
      }
    };
  }

  // ─── Direct cache access ──────────────────────────────────────────────────

  /**
   * Returns the raw data for `key`, or `undefined` if not present.
   * Does not trigger a fetch.
   */
  getQueryData<T>(key: string): T | undefined {
    return this.cache.get(key)?.data as T | undefined;
  }

  /**
   * Writes data directly to the cache for `key`, bypassing fetch.
   * Accepts a direct value or an updater function `(prev) => next`.
   * Notifies all subscribers.
   *
   * @example
   * store.setQueryData('["todos"]', [...todos, newTodo]);
   * store.setQueryData<Todo[]>('["todos"]', (prev) => [...(prev ?? []), newTodo]);
   */
  setQueryData<T>(key: string, data: T | ((prev: T | undefined) => T)): void {
    const prev = this.cache.get(key)?.data as T | undefined;
    const next = typeof data === 'function' ? (data as (prev: T | undefined) => T)(prev) : data;
    this.set(key, { data: next, timestamp: Date.now(), error: null });
    // Start gc timer if no active runners — set() no longer does this for us
    if ((this.keyRefs.get(key) ?? 0) === 0) {
      this.startGcTimer(key);
    }
    this.emitEvent({ type: 'set', key: JSON.parse(key) as unknown[] });
  }

  /**
   * Marks all entries whose serialized key matches `serializedPrefix` as stale
   * (sets timestamp to 0) and notifies their subscribers.
   * Uses array prefix matching via matchesKey(): `invalidate('["todos"]')` matches
   * `["todos"]`, `["todos",1]`, `["todos","active"]`, etc.
   */
  invalidate(serializedPrefix: string): void {
    const prefixArray = JSON.parse(serializedPrefix) as unknown[];
    const invalidatedKeys: string[] = [];
    const matchedKeyArrays: unknown[][] = [];
    for (const key of this.cache.keys()) {
      // Lazily populate keyArrays for keys hydrated from persisted storage.
      let keyArray = this.keyArrays.get(key);
      if (!keyArray) {
        try {
          const parsed = JSON.parse(key) as unknown;
          if (!Array.isArray(parsed)) {
            console.warn(`[kvale] Skipping corrupt cache key (not an array): ${key}`);
            continue;
          }
          keyArray = parsed;
          this.keyArrays.set(key, keyArray);
        } catch {
          console.warn(`[kvale] Skipping cache key with invalid JSON: ${key}`);
          continue;
        }
      }
      if (matchesKey(prefixArray, keyArray)) {
        const entry = this.cache.get(key);
        if (entry) {
          this.cache.set(key, { ...entry, timestamp: 0 });
          invalidatedKeys.push(key);
          matchedKeyArrays.push(keyArray);
        }
      }
    }
    for (const key of invalidatedKeys) this.notify(key);
    if (invalidatedKeys.length > 0) {
      this.emitEvent({ type: 'invalidate', key: prefixArray, matchedKeys: matchedKeyArrays });
    }
  }

  /**
   * Returns an iterator over all `[serializedKey, CacheEntry]` pairs.
   * Intended for use by devtools.
   */
  entries(): IterableIterator<[string, CacheEntry]> {
    return this.cache.entries();
  }

  // ─── In-flight deduplication ──────────────────────────────────────────────

  /** Returns the in-flight promise for `key`, or `undefined` if none. */
  getInFlight(key: string): Promise<unknown> | undefined {
    return this.inFlight.get(key);
  }

  /** Registers an in-flight promise and its AbortController for `key`. */
  setInFlight(key: string, promise: Promise<unknown>, controller: AbortController): void {
    this.inFlight.set(key, promise);
    this.inFlightControllers.set(key, controller);
  }

  /** Removes the in-flight promise and controller for `key`. */
  clearInFlight(key: string): void {
    this.inFlight.delete(key);
    this.inFlightControllers.delete(key);
  }

  /**
   * Aborts the in-flight request for `key`. No-op if no request is in flight.
   * Call this in `onMutate` before writing optimistic data to prevent a racing
   * refetch from overwriting the optimistic value.
   */
  cancelQuery(key: string): void {
    this.inFlightControllers.get(key)?.abort();
  }

  // ─── gcTime ───────────────────────────────────────────────────────────────

  /**
   * Increments the active runner count for `key` and cancels any pending gcTime timer.
   * Called by `QueryRunner` on `execute()`.
   */
  registerKey(key: string): void {
    const count = this.keyRefs.get(key) ?? 0;
    this.keyRefs.set(key, count + 1);
    const timer = this.gcTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.gcTimers.delete(key);
    }
  }

  /**
   * Decrements the active runner count for `key`. If count reaches 0 and an entry
   * exists, starts a gcTime timer to prune it.
   * Called by `QueryRunner` on `destroy()`.
   */
  unregisterKey(key: string): void {
    const count = this.keyRefs.get(key) ?? 0;
    const newCount = Math.max(0, count - 1);
    this.keyRefs.set(key, newCount);
    if (newCount === 0 && this.cache.has(key)) {
      this.startGcTimer(key);
    }
  }

  private startGcTimer(key: string): void {
    if (this.gcTimers.has(key)) return; // already scheduled — don't reset
    const timer = setTimeout(() => {
      this.cache.delete(key);
      this.keyArrays.delete(key);
      this.gcTimers.delete(key);
      this.keyRefs.delete(key);
      if (this.config.persist) persistCache(this.config.persist, this.cache);
      this.emitEvent({ type: 'gc', key: JSON.parse(key) as unknown[] });
    }, this.config.gcTime);
    this.gcTimers.set(key, timer);
  }

  private emitEvent(event: CacheEvent): void {
    try {
      this.config.onEvent?.(event);
    } catch {
      // silently swallow
    }
  }

  private notify(key: string): void {
    const subs = this.subscribers.get(key);
    if (subs) {
      for (const cb of subs) cb();
    }
  }
}
