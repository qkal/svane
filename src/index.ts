import { CacheStore } from './core/cache';
import { QueryRunner } from './core/query';
import { CACHE_DEFAULTS } from './core/types';
import type { CacheConfig, QueryConfig } from './core/types';
import { createReactiveQuery } from './svelte/adapter.svelte';

export type { CacheConfig, QueryConfig } from './core/types';
export type { QueryStatus } from './core/types';

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
 * Creates a cache instance with global configuration.
 * Call once per app, typically in `$lib/cache.ts`.
 *
 * @example
 * import { createCache } from 'quelt';
 * export const cache = createCache({ staleTime: 30_000 });
 */
export function createCache(config: Partial<CacheConfig> = {}) {
  const resolvedConfig: CacheConfig = { ...CACHE_DEFAULTS, ...config };
  const store = new CacheStore({ persist: resolvedConfig.persist });

  return {
    /**
     * Creates a reactive query bound to this cache instance.
     * Returns a reactive object — access properties directly, do not destructure.
     *
     * @example
     * const todos = cache.query<Todo[]>({
     *   key: 'todos',
     *   fn: () => fetch('/api/todos').then(r => r.json()),
     * });
     * // In template: {#if todos.status === 'loading'}
     */
    query<T>(queryConfig: QueryConfig<T>): QueryResult<T> {
      const runner = new QueryRunner<T>(store, queryConfig, resolvedConfig);
      return createReactiveQuery(runner) as QueryResult<T>;
    },
  };
}
