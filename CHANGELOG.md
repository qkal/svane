# Changelog

## [0.1.3] — 2026-04-03

### Fixed

- **Bug:** `CacheStore.set()` incorrectly deleted parsed key arrays immediately after caching them, forcing redundant re-parsing on every subsequent invalidation
- **Bug:** Duplicate `keyArrays.delete(key)` call in `startGcTimer` cleanup
- **Test:** Timestamp race condition in security test for corrupted cache keys
- **Test:** Set Vitest environment to `jsdom` globally so DOM-dependent tests run correctly

### Optimized

- `matchesKey()` now uses reference equality fast-path (`===`) before falling back to `JSON.stringify` comparison — significantly faster for string/number key segments

### Changed (npm release prep)

- Added `main`, `module`, `import` export condition, `sideEffects: false`, `engines`, `keywords`, `homepage`, `repository`, `bugs`, and `author` fields to `package.json`
- Included `README.md`, `LICENSE`, and `CHANGELOG.md` in published package `files`
- Version bumped to `0.1.3`

## [0.1.2] — 2026-03-31

### Added
- `cache.dehydrate()` — serialize cache to a JSON-safe snapshot for SSR
- `cache.rehydrate(state)` — seed client cache from server snapshot; prevents loading flash
- `DehydratedState` type exported from public API
- Global `onError` hook on `CacheConfig` — fires once after all retries exhausted (queries pass key array, mutations pass `[]`)
- `retry` now accepts `(failureCount: number, error: Error) => boolean` in addition to `number` — allows skipping retries on 401/404
- `timeout` on `CacheConfig` and `QueryConfig` — aborts fetch after N ms; each retry attempt gets a fresh timeout
- `onEvent` hook on `CacheConfig` — typed event bus for all cache lifecycle events
- `CacheEvent` discriminated union exported from public API: `fetch:start`, `fetch:success`, `fetch:error`, `invalidate`, `set`, `gc`, `rehydrate`
- Per-query `retry` and `timeout` overrides on `QueryConfig`

## [0.1.1] — 2026-03-28

### Added
- `cache.mutate()` — reactive mutation with optimistic update support (`onMutate`, `onSuccess`, `onError`, `onSettled`)
- `cache.invalidate(key)` — prefix-based cache invalidation
- `cache.prefetch(config)` — populate cache without creating a reactive result; deduplicates concurrent prefetches
- `cache.getQueryData(key)` / `cache.setQueryData(key, data)` — direct cache read/write
- `cache.cancelQuery(key)` — abort in-flight request
- Reactive keys — `key: () => ['todos', userId]` re-runs query when dependencies change
- `select` transform — `cache.query<Todo[], ActiveTodo[]>({ select: ... })`
- `keepPreviousData` — show stale data during key transitions
- `refetchOnReconnect` — refetch stale queries on network reconnect
- Exponential backoff on retry (capped at 30s)
- `gcTime` — prune inactive cache entries after configurable idle period (default 5 min)
- Request deduplication for concurrent identical queries

## [0.1.0] — 2026-03-28

### Added
- `createCache()` factory with global config
- `cache.query()` returning reactive object with status discriminant
- `status`: `'idle' | 'loading' | 'refreshing' | 'success' | 'error'`
- `data`, `error`, `isStale`, `refetch()`
- `staleTime`, `refetchInterval`, `refetchOnWindowFocus`, `enabled`
- `enabled` accepts getter function for reactive dependent queries
- Retry with linear backoff (300ms * attempt)
- Optional `localStorage` persistence
- Works in `.svelte`, `.svelte.ts`, and `.ts` files
