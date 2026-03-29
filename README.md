# Quelm

**Smart data layer for SvelteKit — fetch, cache, done.**

[![npm](https://img.shields.io/npm/v/quelm)](https://npmjs.com/package/quelm)
[![license](https://img.shields.io/npm/l/quelm)](./LICENSE)

## Why Quelm?

- **Svelte 5 runes native** — `$state`, `$effect`. No `writable()`, no wrappers.
- **No `QueryClientProvider`** — just `createCache()` and `cache.query()`.
- **Works in `.svelte`, `.svelte.ts`, and `.ts`** files.
- **Zero dependencies** — ~3kb minified.

## Quick Start

```bash
bun add quelm
```

```ts
// $lib/cache.ts
import { createCache } from 'quelm';
export const cache = createCache({ staleTime: 30_000 });
```

```svelte
<script lang="ts">
  import { cache } from '$lib/cache';

  const todos = cache.query<Todo[]>({
    key: 'todos',
    fn: () => fetch('/api/todos').then(r => r.json()),
  });
</script>

{#if todos.status === 'loading'}
  <p>Loading...</p>
{:else if todos.status === 'error'}
  <p>Error: {todos.error.message}</p>
{:else}
  {#each todos.data as todo}
    <p>{todo.title}</p>
  {/each}
{/if}
```

## API Reference

### `createCache(config?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `staleTime` | `number` | `30_000` | ms until data is stale |
| `retry` | `number` | `1` | retries on failure |
| `refetchOnWindowFocus` | `boolean` | `true` | refetch stale on tab focus |
| `persist` | `Storage` | `undefined` | e.g. `localStorage` |

### `cache.query<T>(config)`

| Option | Type | Description |
|---|---|---|
| `key` | `string \| unknown[]` | Cache key. String auto-wraps. |
| `fn` | `() => Promise<T>` | Fetch function |
| `staleTime` | `number?` | Per-query override |
| `refetchInterval` | `number?` | Polling interval in ms |
| `enabled` | `boolean \| (() => boolean)?` | Conditional execution |

### `QueryResult<T>`

| Property | Type | Description |
|---|---|---|
| `status` | `'idle' \| 'loading' \| 'refreshing' \| 'success' \| 'error'` | Current state |
| `data` | `T \| undefined` | Fetched data |
| `error` | `Error \| null` | Last error |
| `isStale` | `boolean` | Data older than staleTime |
| `refetch()` | `() => Promise<void>` | Manual refetch |

## Examples

### Dependent Query

```svelte
<script lang="ts">
  const user = cache.query({ key: 'user', fn: () => getUser() });
  const posts = cache.query({
    key: ['posts', user.data?.id],
    fn: () => getPosts(user.data!.id),
    enabled: () => !!user.data?.id,
  });
</script>
```

### Polling

```svelte
<script lang="ts">
  const prices = cache.query({
    key: 'prices',
    fn: () => fetchPrices(),
    refetchInterval: 5_000,
  });
</script>
```

### Persistence

```ts
export const cache = createCache({ persist: localStorage });
```

## Roadmap

- **v1.1** — `cache.mutate()`, `cache.invalidate()`, request deduplication
- **v1.2** — SSR hydration bridge, `cache.prefetch()`

## License

MIT © [Complexia](https://complexia.org)
