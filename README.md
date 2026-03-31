# Kvale

**Smart data layer for SvelteKit — fetch, cache, done.**

[![TypeScript](https://img.shields.io/badge/powered%20by-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![npm](https://img.shields.io/npm/v/kvale)](https://npmjs.com/package/kvale)
[![license](https://img.shields.io/badge/license-BSD--2--Clause--Patent-blue)](./LICENSE)
[![svelte](https://img.shields.io/badge/svelte-5%2B-ff3e00)](https://svelte.dev)
[![zero deps](https://img.shields.io/badge/dependencies-zero-brightgreen)](./package.json)

---

> **A statement from Kal, founder of [Complexia](https://complexia.org)**
>
> Software built for the age of AI must be transparent, auditable, and correct by design. As artificial intelligence becomes a native tool in development workflows — reviewing code, generating logic, suggesting patterns — the libraries and data layers it interacts with carry new responsibility. Ambiguous state, hidden side effects, and silent failures are not just developer experience problems: they become safety problems when AI reasoning depends on them. At Complexia, we believe the right response is to build tools that are small, honest, and fully traceable. Kvale is one expression of that commitment.
>
> — Kal ([@qkal](https://github.com/qkal))

---

Kvale is a **zero-dependency, runes-native data fetching and caching library** built from the ground up for SvelteKit and Svelte 5. It gives you stale-while-revalidate caching, background refetching, polling, persistence, mutations, SSR hydration, and an observability event bus — with an API so minimal it disappears into your code.

No providers. No wrappers. No boilerplate. Just `createCache()` and `cache.query()`.

```svelte
<script lang="ts">
  import { cache } from '$lib/cache';

  const todos = cache.query<Todo[]>({
    key: 'todos',
    fn: (signal) => fetch('/api/todos', { signal }).then(r => r.json()),
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

---

## Why Kvale?

- **Born in Svelte 5** — uses `$state` and `$effect` natively. No legacy store adapters, no `writable()`, no React-isms.
- **No `QueryClientProvider`** — call `createCache()` once and use it anywhere. Your app stays yours.
- **Works everywhere** — `.svelte`, `.svelte.ts`, and plain `.ts` files. The pure TypeScript core has zero framework dependencies and runs in any JS environment including SSR.
- **Stale-while-revalidate** — cached data is shown instantly while fresh data loads silently in the background. Users never see a blank state.
- **SSR-ready** — `dehydrate()` / `rehydrate()` eliminates the loading flash on first render.
- **Reactive dependent queries** — `enabled: () => !!user.data?.id` just works. Svelte tracks it automatically.
- **Impossible states eliminated** — a single `status` discriminant (`'idle' | 'loading' | 'refreshing' | 'success' | 'error'`) replaces the footgun of boolean flags.
- **Zero dependencies** — ~3kb minified. Nothing else pulled in.

---

## Installation

```bash
bun add kvale   # recommended
npm install kvale
pnpm add kvale
```

**Peer dependency:** Svelte 5.25.0 or later.

---

## Quick Start

**Step 1: Create your cache instance**

```ts
// src/lib/cache.ts
import { createCache } from 'kvale';

export const cache = createCache({
  staleTime: 30_000,           // data stays fresh for 30s (default)
  retry: 1,                    // retry once on failure (default)
  refetchOnWindowFocus: true,  // refetch stale queries on tab focus (default)
});
```

**Step 2: Query data in any component**

```svelte
<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { cache } from '$lib/cache';

  const todos = cache.query<Todo[]>({
    key: 'todos',
    fn: (signal) => fetch('/api/todos', { signal }).then(r => r.json()),
  });
</script>

{#if todos.status === 'loading'}
  <p>Loading...</p>
{:else if todos.status === 'error'}
  <p>Something went wrong: {todos.error.message}</p>
{:else if todos.status === 'success'}
  <ul>
    {#each todos.data as todo}
      <li class:done={todo.completed}>{todo.title}</li>
    {/each}
  </ul>
{/if}

{#if todos.status === 'refreshing'}
  <small>Refreshing in background…</small>
{/if}
```

**Step 3: Do not destructure the result**

`QueryResult` is a reactive object. Destructuring breaks reactivity — always access properties directly:

```ts
// ✅ correct
todos.status
todos.data

// ❌ breaks reactivity
const { status, data } = todos;
```

---

## API Reference

### `createCache(config?)`

Creates a shared cache instance. Call once per app, typically in `$lib/cache.ts`.

| Option | Type | Default | Description |
|---|---|---|---|
| `staleTime` | `number` | `30_000` | Milliseconds until cached data is considered stale |
| `retry` | `number \| (failureCount, error) => boolean` | `1` | Retry count or predicate (e.g. skip retrying 401s) |
| `refetchOnWindowFocus` | `boolean` | `true` | Refetch stale queries when the tab regains focus |
| `refetchOnReconnect` | `boolean` | `true` | Refetch stale queries when the browser comes back online |
| `persist` | `Storage` | `undefined` | Persist cache to storage (e.g. `localStorage`) |
| `gcTime` | `number` | `300_000` | Milliseconds before an inactive entry is garbage collected |
| `timeout` | `number` | `undefined` | Abort fetch after N ms; each retry gets a fresh timeout |
| `onError` | `(error, key) => void` | `undefined` | Called once after all retries fail (mutations pass `key: []`) |
| `onEvent` | `(event: CacheEvent) => void` | `undefined` | Lifecycle event bus — see [Observability](#observability) |

### `cache.query<T>(config)`

Creates a reactive query bound to the cache. Returns a `QueryResult<T>`.

| Option | Type | Description |
|---|---|---|
| `key` | `string \| unknown[] \| () => string \| unknown[]` | Cache key. Strings auto-wrap to `[string]`. Use a getter for reactive keys. |
| `fn` | `(signal: AbortSignal) => Promise<T>` | Async function that fetches the data. Pass `signal` to `fetch` for cancellation. |
| `staleTime` | `number?` | Per-query override of global `staleTime` |
| `retry` | `number \| (failureCount, error) => boolean?` | Per-query override of global `retry` |
| `timeout` | `number?` | Per-query override of global `timeout` |
| `refetchInterval` | `number?` | Poll interval in ms. Omit to disable polling. |
| `enabled` | `boolean \| (() => boolean)?` | Set `false` or return `false` to skip the query |
| `keepPreviousData` | `boolean?` | Show previous data while loading after a key change |
| `select` | `(data: T) => U?` | Transform data before it reaches the component |

### `QueryResult<T>`

The reactive object returned by `cache.query()`. Access properties directly — do not destructure.

| Property | Type | Description |
|---|---|---|
| `status` | `'idle' \| 'loading' \| 'refreshing' \| 'success' \| 'error'` | Current fetch state |
| `data` | `T \| undefined` | The fetched data, or `undefined` before first success |
| `error` | `Error \| null` | The last error, or `null` |
| `isStale` | `boolean` | `true` when data is older than `staleTime` |
| `refetch()` | `() => Promise<void>` | Manually trigger a refetch |

| Status | Meaning |
|---|---|
| `idle` | Query is disabled (`enabled: false`) |
| `loading` | First fetch in progress, no cached data available |
| `refreshing` | Background refetch — stale data is still visible |
| `success` | Data loaded successfully |
| `error` | Fetch failed after all retries |

### `cache.mutate<TData, TVariables>(config)`

Creates a reactive mutation. Returns a `MutationResult`.

| Option | Type | Description |
|---|---|---|
| `fn` | `(variables, signal) => Promise<TData>` | The mutation function |
| `onMutate` | `(variables) => TContext?` | Called before `fn`. Return value is passed to other hooks as `context`. |
| `onSuccess` | `(data, variables, context) => void?` | Called on success |
| `onError` | `(error, variables, context) => void?` | Called on error |
| `onSettled` | `(data, error, variables, context) => void?` | Called after success or error |

| Property | Type | Description |
|---|---|---|
| `status` | `'idle' \| 'loading' \| 'success' \| 'error'` | Current mutation state |
| `data` | `TData \| undefined` | Result of the last successful mutation |
| `error` | `Error \| null` | Error from the last failed mutation |
| `mutate(variables)` | `(variables) => Promise<void>` | Trigger the mutation |
| `reset()` | `() => void` | Reset state to `idle` |

### `cache.invalidate(key)`

Mark all cache entries matching `key` (by array prefix) as stale and notify active queries to refetch.

```ts
cache.invalidate('todos');           // invalidates all ['todos', ...] entries
cache.invalidate(['todos', userId]); // invalidates one specific entry
```

### `cache.prefetch(config)`

Populate the cache without creating a reactive result. No-op if the entry is still fresh.

```ts
await cache.prefetch({ key: 'todos', fn: (signal) => fetchTodos(signal) });
```

### `cache.getQueryData<T>(key)` / `cache.setQueryData<T>(key, data)`

Read or write cache data directly, without triggering a fetch.

```ts
const todos = cache.getQueryData<Todo[]>('todos');
cache.setQueryData('todos', [...todos, newTodo]);
cache.setQueryData<Todo[]>('todos', (prev) => [...(prev ?? []), newTodo]); // updater function
```

### `cache.cancelQuery(key)`

Abort the in-flight request for `key`. Use in `onMutate` before writing optimistic data.

### `cache.dehydrate()`

Serialize all valid cache entries into a JSON-safe snapshot. Use in SvelteKit `+page.server.ts` to pass server-fetched data to the client.

### `cache.rehydrate(state)`

Seed the client cache from a server snapshot. Call before `cache.query()` to prevent a loading flash on first render.

---

## Examples

### SSR — No Loading Flash

Fetch on the server, hydrate on the client. The client query hits the cache immediately and starts at `status: 'success'`.

```ts
// src/routes/+page.server.ts
import { createCache } from 'kvale';

export async function load() {
  const serverCache = createCache();
  await serverCache.prefetch({
    key: 'todos',
    fn: (signal) => fetch('https://api.example.com/todos', { signal }).then(r => r.json()),
  });
  return { dehydrated: serverCache.dehydrate() };
}
```

```svelte
<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { cache } from '$lib/cache';

  const { data } = $props();
  cache.rehydrate(data.dehydrated); // seed before query

  const todos = cache.query({
    key: 'todos',
    fn: (signal) => fetch('/api/todos', { signal }).then(r => r.json()),
  }); // starts at status: 'success' — no flash
</script>
```

### Mutations with Optimistic Updates

```svelte
<script lang="ts">
  import { cache } from '$lib/cache';

  const deleteTodo = cache.mutate<void, number>({
    fn: (id, signal) => fetch(`/api/todos/${id}`, { method: 'DELETE', signal }),
    onMutate: (id) => {
      const prev = cache.getQueryData<Todo[]>('todos');
      cache.cancelQuery('todos');
      cache.setQueryData('todos', prev?.filter(t => t.id !== id));
      return prev; // rollback context
    },
    onError: (_err, _id, prev) => cache.setQueryData('todos', prev),
    onSettled: () => cache.invalidate('todos'),
  });
</script>

<button onclick={() => deleteTodo.mutate(todo.id)}>
  {deleteTodo.status === 'loading' ? 'Deleting…' : 'Delete'}
</button>
```

### Conditional Retry

Skip retrying on client errors (4xx) — only retry on server errors (5xx) or network failures.

```ts
export const cache = createCache({
  retry: (failureCount, error) => {
    const status = (error as { status?: number }).status;
    return status !== undefined && status >= 500 && failureCount < 3;
  },
});
```

### Request Timeout

Abort any fetch that takes longer than 5 seconds, with a fresh timeout per retry attempt.

```ts
export const cache = createCache({ timeout: 5_000 });
```

### Observability

Wire up logging, metrics, or error reporting via the event bus.

```ts
import { createCache, type CacheEvent } from 'kvale';

export const cache = createCache({
  onEvent: (event: CacheEvent) => {
    if (event.type === 'fetch:error') {
      console.warn(`[kvale] fetch failed (attempt ${event.failureCount})`, event.key, event.error);
    }
    if (event.type === 'fetch:success') {
      metrics.timing('cache.fetch', event.duration, { key: event.key.join('.') });
    }
  },
  onError: (error, key) => {
    toast.error(`Failed to load ${key.join('/')}: ${error.message}`);
  },
});
```

`CacheEvent` variants:

| Type | Extra fields | Description |
|---|---|---|
| `fetch:start` | `key` | A network request began |
| `fetch:success` | `key`, `duration` | Request completed successfully |
| `fetch:error` | `key`, `error`, `failureCount` | Request failed (fires per attempt, including retries) |
| `invalidate` | `key`, `matchedKeys` | `cache.invalidate()` was called |
| `set` | `key` | `cache.setQueryData()` wrote data directly |
| `gc` | `key` | An inactive entry was pruned by `gcTime` |
| `rehydrate` | `keys` | `cache.rehydrate()` seeded entries from a server snapshot |

### Dependent Query

```svelte
<script lang="ts">
  import { cache } from '$lib/cache';

  const user = cache.query({
    key: 'user',
    fn: (signal) => fetch('/api/me', { signal }).then(r => r.json()),
  });

  const posts = cache.query({
    key: () => ['posts', user.data?.id],
    fn: (signal) => fetch(`/api/posts?user=${user.data!.id}`, { signal }).then(r => r.json()),
    enabled: () => !!user.data?.id,
  });
</script>
```

### Polling

```svelte
<script lang="ts">
  import { cache } from '$lib/cache';

  const prices = cache.query({
    key: 'crypto-prices',
    fn: (signal) => fetch('/api/prices', { signal }).then(r => r.json()),
    refetchInterval: 5_000,
  });
</script>
```

### localStorage Persistence

```ts
// src/lib/cache.ts
import { createCache } from 'kvale';

export const cache = createCache({ persist: localStorage });
```

---

## Roadmap

- ~~**v0.1.0**~~ — `createCache()`, `cache.query()`, stale-while-revalidate, polling, persistence ✓
- ~~**v0.1.1**~~ — `cache.mutate()`, `cache.invalidate()`, `cache.prefetch()`, reactive keys, `select`, `keepPreviousData`, request deduplication, gcTime ✓
- ~~**v0.1.2**~~ — SSR (`dehydrate`/`rehydrate`), `onError`, `onEvent`, `retry` as function, `timeout` ✓
- **v0.1.3** — Infinite / paginated queries, structural sharing, query observers

---

## Contributing

We welcome contributions of all kinds. See [CONTRIBUTING.md](./CONTRIBUTING.md) to get started.

---

## License

BSD-2-Clause-Patent © Kal, founder of [Complexia](https://complexia.org)
