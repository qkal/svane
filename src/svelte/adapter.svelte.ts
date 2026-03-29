import type { QueryRunner } from '../core/query';
import type { QueryState } from '../core/types';

/**
 * Bridges a QueryRunner into Svelte 5 reactive getters using `$state` and `$effect`.
 * The returned object uses getters so that property access reads from reactive state.
 * Automatically cleans up the runner on component unmount via `$effect` return.
 *
 * @example
 * const runner = new QueryRunner(store, config, cacheConfig);
 * return createReactiveQuery(runner);
 */
export function createReactiveQuery<T>(runner: QueryRunner<T>) {
  let state = $state<QueryState<T>>(runner.getState());

  $effect(() => {
    // Reading runner.isEnabled() here registers reactive dependencies.
    // If enabled is a getter closing over $state, Svelte tracks it and
    // re-runs this effect when it changes — enabling dependent queries.
    if (!runner.isEnabled()) return;

    const unsubscribe = runner.subscribe((newState) => {
      state = newState;
    });
    runner.execute();

    return () => {
      unsubscribe();
      runner.destroy();
    };
  });

  return {
    get status() { return state.status; },
    get data() { return state.data; },
    get error() { return state.error; },
    get isStale() { return state.isStale; },
    refetch: () => runner.refetch(),
  };
}
