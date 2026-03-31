import { CacheStore } from './core/cache';
import { normalizeKey, serializeKey } from './core/key';
import { dehydrate as ssrDehydrate, rehydrate as ssrRehydrate } from './core/ssr';
import { CACHE_DEFAULTS } from './core/types';
import type {
  CacheConfig,
  CacheEvent,
  DehydratedState,
  MutationConfig,
  MutationStatus,
  QueryConfig,
  QueryStatus,
} from './core/types';
import { createReactiveQuery } from './svelte/adapter.svelte';
import { createReactiveMutation } from './svelte/mutation-adapter.svelte';

export type { CacheConfig, QueryConfig, MutationConfig } from './core/types';
export type { QueryStatus, MutationStatus, CacheEvent, DehydratedState } from './core/types';

/**
 * The reactive object returned by `cache.query()`.
 * Properties are getters — do not destructure, as that breaks Svelte 5 reactivity.
 */
export interface QueryResult<T> {
  readonly status: 'idle' | 'loading' | 'refreshing' | 'success' | 'error';
  readonly data: T | undefined;
  readonly error: Error | null;
  readonly isStale: boolean;
  refetch(): Promise<void>;
}

/**
 * The reactive object returned by `cache.mutate()`.
 * Properties are getters — do not destructure.
 */
export interface MutationResult<TData, TVariables> {
  readonly status: 'idle' | 'loading' | 'success' | 'error';
  readonly data: TData | undefined;
  readonly error: Error | null;
  mutate(variables: TVariables): Promise<void>;
  reset(): void;
}

/**
 * Creates a cache instance with global configuration.
 * Call once per app, typically in `$lib/cache.ts`.
 *
 * @example
 * import { createCache } from 'kvale';
 * export const cache = createCache({ staleTime: 30_000 });
 */
export function createCache(config: Partial<CacheConfig> = {}) {
  const resolvedConfig: CacheConfig = { ...CACHE_DEFAULTS, ...config };
  const store = new CacheStore({
    persist: resolvedConfig.persist,
    gcTime: resolvedConfig.gcTime,
    onEvent: resolvedConfig.onEvent,
  });

  return {
    /**
     * Creates a reactive query bound to this cache instance.
     * Returns a reactive object — access properties directly, do not destructure.
     * Accepts a key getter for reactive keys: `key: () => ['todos', userId]`.
     *
     * @example
     * const todos = cache.query<Todo[]>({
     *   key: 'todos',
     *   fn: (signal) => fetch('/api/todos', { signal }).then(r => r.json()),
     * });
     */
    query<T, U = T>(queryConfig: QueryConfig<T, U>): QueryResult<U> {
      return createReactiveQuery<T, U>(store, queryConfig, resolvedConfig) as QueryResult<U>;
    },

    /**
     * Creates a reactive mutation. Call inside a component (runes context).
     * Use `onMutate` to write optimistic data and return rollback context.
     * Use `onError` to restore rollback context. Use `onSettled` to invalidate.
     *
     * @example
     * const deleteTodo = cache.mutate<void, number>({
     *   fn: (id, signal) => fetch(`/api/todos/${id}`, { method: 'DELETE', signal }),
     *   onMutate: (id) => {
     *     const prev = cache.getQueryData<Todo[]>('todos');
     *     cache.cancelQuery('todos');
     *     cache.setQueryData('todos', prev?.filter(t => t.id !== id));
     *     return prev;
     *   },
     *   onError: (_err, _id, prev) => cache.setQueryData('todos', prev),
     *   onSettled: () => cache.invalidate('todos'),
     * });
     */
    mutate<TData, TVariables, TContext = unknown>(
      mutationConfig: MutationConfig<TData, TVariables, TContext>,
    ): MutationResult<TData, TVariables> {
      return createReactiveMutation<TData, TVariables, TContext>(
        mutationConfig,
        resolvedConfig.onError,
      );
    },

    /**
     * Marks all cache entries matching `key` (by array prefix) as stale and
     * notifies active queries to re-fetch.
     *
     * @example
     * cache.invalidate('todos');           // invalidates all 'todos' queries
     * cache.invalidate(['todos', userId]); // invalidates one specific user's todos
     */
    invalidate(key: string | unknown[]): void {
      const normalized = normalizeKey(key);
      store.invalidate(serializeKey(normalized));
    },

    /**
     * Populates the cache without creating a reactive result.
     * No-ops if the entry exists and is still fresh.
     * Use on route hover or before navigation to pre-load data.
     *
     * @example
     * cache.prefetch({ key: 'todos', fn: (signal) => fetchTodos(signal) });
     */
    async prefetch<T>(
      prefetchConfig: Pick<QueryConfig<T>, 'key' | 'fn' | 'staleTime'>,
    ): Promise<void> {
      const key =
        typeof prefetchConfig.key === 'function' ? prefetchConfig.key() : prefetchConfig.key;
      const normalized = normalizeKey(key);
      const serialized = serializeKey(normalized);
      const staleTime = prefetchConfig.staleTime ?? resolvedConfig.staleTime;
      if (!store.isStale(serialized, staleTime)) return;

      // Deduplicate: attach to existing in-flight promise if present
      const existing = store.getInFlight(serialized);
      if (existing) {
        try {
          await existing;
        } catch {
          // best-effort — caller doesn't need the error
        }
        return;
      }

      const controller = new AbortController();
      const promise = prefetchConfig.fn(controller.signal);
      store.setInFlight(serialized, promise, controller);
      try {
        const data = await promise;
        store.set(serialized, { data, timestamp: Date.now(), error: null });
      } catch {
        // prefetch is best-effort — silently discard failures
      } finally {
        store.clearInFlight(serialized);
      }
    },

    /**
     * Reads data directly from the cache for `key`.
     * Returns `undefined` if the key is not present.
     *
     * @example
     * const todos = cache.getQueryData<Todo[]>('todos');
     */
    getQueryData<T>(key: string | unknown[]): T | undefined {
      const normalized = normalizeKey(key);
      return store.getQueryData<T>(serializeKey(normalized));
    },

    /**
     * Writes data directly to the cache for `key`, bypassing fetch.
     * Accepts a value or an updater function.
     * Notifies all active queries subscribed to this key.
     *
     * @example
     * cache.setQueryData('todos', [...todos, newTodo]);
     * cache.setQueryData<Todo[]>('todos', (prev) => [...(prev ?? []), newTodo]);
     */
    setQueryData<T>(key: string | unknown[], data: T | ((prev: T | undefined) => T)): void {
      const normalized = normalizeKey(key);
      store.setQueryData<T>(serializeKey(normalized), data);
    },

    /**
     * Aborts the in-flight request for `key`. Call in `onMutate` before writing
     * optimistic data to prevent a racing refetch from overwriting it.
     *
     * @example
     * onMutate: (id) => {
     *   cache.cancelQuery('todos');
     *   cache.setQueryData('todos', prev?.filter(t => t.id !== id));
     * }
     */
    cancelQuery(key: string | unknown[]): void {
      const normalized = normalizeKey(key);
      store.cancelQuery(serializeKey(normalized));
    },

    /**
     * Serializes all valid cache entries into a JSON-safe snapshot.
     * Pass the result through SvelteKit's `load()` return value.
     *
     * @example
     * // +page.server.ts
     * const serverCache = createCache();
     * await serverCache.prefetch({ key: 'todos', fn: fetchTodos });
     * return { dehydrated: serverCache.dehydrate() };
     */
    dehydrate(): DehydratedState {
      return ssrDehydrate(store);
    },

    /**
     * Seeds this cache from a server-side snapshot. Additive — existing entries
     * are not overwritten. Call before `cache.query()` to prevent a loading flash.
     *
     * @example
     * // +page.svelte
     * cache.rehydrate(data.dehydrated);
     * const todos = cache.query({ key: 'todos', fn: fetchTodos });
     */
    rehydrate(state: DehydratedState): void {
      ssrRehydrate(store, state, resolvedConfig.onEvent);
    },
  };
}
