import type { CacheStore } from '../core/cache';
import { QueryRunner } from '../core/query';
import type { CacheConfig, QueryConfig, QueryState } from '../core/types';

function applySelect<T, U>(
  state: QueryState<T>,
  select?: (data: T) => U,
): QueryState<T | U> {
  if (select !== undefined && state.data !== undefined) {
    return { ...state, data: select(state.data) };
  }
  return state;
}

/**
 * Bridges a QueryConfig into Svelte 5 reactive getters using `$state` and `$effect`.
 * Creates a new QueryRunner internally. Handles reactive key changes by destroying
 * and recreating the runner when the key getter returns a new value.
 *
 * @example
 * const result = createReactiveQuery(store, { key: 'todos', fn }, cacheConfig);
 * // result.data, result.status, result.error, result.isStale are all reactive getters
 */
export function createReactiveQuery<T, U = T>(
  store: CacheStore,
  queryConfig: QueryConfig<T, U>,
  cacheConfig: CacheConfig,
) {
  let state = $state<QueryState<T | U>>({
    status: 'idle',
    data: undefined,
    error: null,
    isStale: false,
  });
  let currentRunner: QueryRunner<T, U> | null = null;
  let previousData: T | undefined = undefined;

  $effect(() => {
    // Resolve key — if it's a getter, calling it here registers reactive dependencies.
    // Svelte tracks all $state reads inside $effect and re-runs when they change.
    const resolvedKey =
      typeof queryConfig.key === 'function' ? queryConfig.key() : queryConfig.key;

    const runner = new QueryRunner<T, U>(
      store,
      { ...queryConfig, key: resolvedKey },
      cacheConfig,
      queryConfig.keepPreviousData ? previousData : undefined,
    );
    currentRunner = runner;

    if (!runner.isEnabled()) return;

    const unsubscribe = runner.subscribe((newState) => {
      if (newState.data !== undefined) previousData = newState.data as T;
      state = applySelect(newState, queryConfig.select);
    });

    // Set initial state with select applied
    state = applySelect(runner.getState(), queryConfig.select);

    runner.reset();
    runner.execute();

    return () => {
      if (runner.getState().data !== undefined) previousData = runner.getState().data as T;
      unsubscribe();
      runner.destroy();
    };
  });

  return {
    get status() {
      return state.status;
    },
    get data() {
      return state.data as U | undefined;
    },
    get error() {
      return state.error;
    },
    get isStale() {
      return state.isStale;
    },
    refetch: (): Promise<void> => {
      if (!currentRunner?.isEnabled()) return Promise.resolve();
      return currentRunner.refetch();
    },
  };
}
