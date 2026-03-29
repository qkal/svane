# svane

**Smart data layer for SvelteKit — fetch, cache, done.**

---

## Project Identity

| Field | Value |
|---|---|
| **Name** | svane |
| **npm (standalone)** | `svane` |
| **npm (scoped)** | `@complexia/svane` (re-exports standalone) |
| **GitHub** | `github.com/<your-username>/svane` |
| **License** | Open source (MIT) |
| **Purpose** | Complexia brand visibility + community goodwill |

---

## What Is svane?

A **runes-native, SvelteKit-first data fetching & caching library** that complements SvelteKit's `load()` with a dead-simple `query()` API.

### Why It Exists

- TanStack Query's Svelte adapter spent 18+ months catching up to Svelte 5 runes — many devs left.
- Even with v6, it requires React-isms like `QueryClientProvider` wrappers and thunk syntax `() => ({...})`.
- Developers are rolling their own tiny `resource()` helpers — functional but missing caching, staleness, and refetching.
- **No Svelte-native alternative exists.** svane is born in Svelte, for Svelte.

### Target Audience

- Solo devs / indie hackers shipping fast
- Developers migrating from React/Next.js, Vue/Nuxt

---

## Architecture

### Core Principle

Pure TypeScript core + thin Svelte adapter layer.

```
svane/
├── src/
│   ├── core/              # Zero-dependency TypeScript
│   │   ├── cache.ts       # CacheStore — Map-based cache with staleness tracking
│   │   ├── query.ts       # Query logic — fetch, retry, refetch, polling
│   │   ├── types.ts       # All TypeScript interfaces & generics
│   │   └── storage.ts     # localStorage persistence adapter
│   ├── svelte/            # Thin Svelte adapter
│   │   └── adapter.svelte.ts  # Bridges core events → $state reactivity
│   └── index.ts           # Public API exports
├── tests/
│   ├── core/              # Pure Vitest unit tests (no Svelte compiler)
│   └── svelte/            # @testing-library/svelte component tests
├── package.json
├── svelte.config.js
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

### Why This Split?

- **Core is testable** with plain Vitest — no Svelte compiler needed
- **Core is portable** — theoretically reusable in other frameworks (not a goal, but free)
- **Svelte adapter is thin** — turns cache events into reactive `$state`
- **Single package** — split into `@svane/core` + `@svane/svelte` later if needed

### Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Cache instance | `createCache()` factory | Explicit, testable, no magic globals |
| Callable from | `.svelte`, `.svelte.ts`, **and** plain `.ts` | Maximum flexibility; core doesn't depend on Svelte compiler |
| Reactivity (core) | Subscribe/notify pattern | Works everywhere, no compiler dependency |
| Reactivity (Svelte) | Thin adapter bridges to `$state` | Idiomatic Svelte 5 DX |
| Build tool | `svelte-package` | Purpose-built for Svelte libraries |
| Testing | Vitest + @testing-library/svelte | Unit tests for core, component tests for adapter |
| Type safety | TypeScript generics only | Zero runtime dependencies, validation is user's job |
| Request dedup | Not in v1 | Keep it simple, add in v1.1 |

---

## API Specification

### Setup

```ts
import { createCache } from 'svane';

export const cache = createCache({
  staleTime: 30_000,           // default: 30s — data considered fresh for 30s
  retry: 1,                     // default: 1 — fail fast, dev decides retry logic
  refetchOnWindowFocus: true,   // default: true — refetch when tab becomes active
  persist: localStorage,        // optional — default: undefined (no persistence)
});
```

### Query

```ts
const todos = cache.query({
  key: 'todos',                              // string — auto-wraps to array internally
  // key: ['todos', { status: 'active' }],   // array — for granular cache keying
  fn: () => fetch('/api/todos').then(r => r.json()),

  // Per-query overrides (all optional):
  staleTime: 60_000,           // override global staleTime
  refetchInterval: 5_000,      // poll every 5s
  enabled: true,               // set false to disable (dependent queries)
});
```

### Reactive Object (returned by `query()`)

```ts
interface QueryResult<T> {
  data: T | undefined;         // The fetched data
  loading: boolean;            // true on FIRST fetch (no cached data yet)
  error: Error | null;         // Last error, or null
  isStale: boolean;            // true when data is older than staleTime
  isFetching: boolean;         // true during BACKGROUND refetch (stale data visible)
  refetch: () => Promise<void>; // Manual refetch trigger
}
```

### Key Behaviors

| Behavior | Detail |
|---|---|
| **Stale-while-revalidate** | Cached data shown immediately; background refetch if stale |
| **`loading` vs `isFetching`** | `loading` = first fetch, no data. `isFetching` = background refetch, stale data visible |
| **Cache keys** | String auto-wraps to `[string]`. Array keys enable partial matching for invalidation |
| **`enabled: false`** | Query does not execute until `enabled` becomes `true` (dependent queries) |
| **`refetchOnWindowFocus`** | Listens to `visibilitychange` event, refetches stale queries on tab focus |
| **`refetchInterval`** | Sets up `setInterval` + `refetch()` for polling |
| **Retry** | Default: 1 retry on failure. Configurable per-query and globally |
| **Persistence** | Global opt-in via `createCache({ persist: localStorage })`. Hydrates cache on init |

### Default Values

| Option | Default | Rationale |
|---|---|---|
| `staleTime` | `30_000` (30s) | Opinionated — navigating back feels instant. Differentiator from TanStack's `0` |
| `retry` | `1` | Fail fast — dev decides retry strategy |
| `refetchOnWindowFocus` | `true` | Smart default — stale data refreshes on tab return |
| `refetchInterval` | `undefined` (off) | Polling is opt-in |
| `enabled` | `true` | Queries run by default |
| `persist` | `undefined` (off) | No localStorage unless explicitly configured |

---

## Usage Examples

### Basic Query in a Component

```svelte
<script lang="ts">
  import { cache } from '$lib/cache';

  interface Todo {
    id: number;
    title: string;
    completed: boolean;
  }

  const todos = cache.query<Todo[]>({
    key: 'todos',
    fn: () => fetch('/api/todos').then(r => r.json()),
  });
</script>

{#if todos.loading}
  <p>Loading...</p>
{:else if todos.error}
  <p>Error: {todos.error.message}</p>
{:else}
  {#each todos.data as todo}
    <p>{todo.title}</p>
  {/each}
{/if}
```

### Query with Filters (Array Key)

```svelte
<script lang="ts">
  import { cache } from '$lib/cache';

  let status = $state('active');

  const todos = cache.query<Todo[]>({
    key: ['todos', { status }],
    fn: () => fetch(`/api/todos?status=${status}`).then(r => r.json()),
  });
</script>
```

### Polling (Real-Time Data)

```svelte
<script lang="ts">
  import { cache } from '$lib/cache';

  const prices = cache.query({
    key: 'crypto-prices',
    fn: () => fetch('/api/prices').then(r => r.json()),
    refetchInterval: 5_000, // every 5 seconds
  });
</script>
```

### Dependent Query

```svelte
<script lang="ts">
  import { cache } from '$lib/cache';

  let userId = $state<number | null>(null);

  const user = cache.query({
    key: 'user',
    fn: () => fetch('/api/me').then(r => r.json()),
  });

  const posts = cache.query({
    key: ['posts', { userId: user.data?.id }],
    fn: () => fetch(`/api/posts?user=${user.data!.id}`).then(r => r.json()),
    enabled: !!user.data?.id, // only runs when user data is available
  });
</script>
```

### Reusable Query in .svelte.ts

```ts
// queries/todos.svelte.ts
import { cache } from '$lib/cache';
import type { Todo } from '$lib/types';

export function useTodos(status?: string) {
  return cache.query<Todo[]>({
    key: ['todos', { status }],
    fn: () => fetch(`/api/todos?status=${status ?? ''}`).then(r => r.json()),
  });
}
```

### Reusable Query in Plain .ts

```ts
// queries/todos.ts
import { cache } from '$lib/cache';
import type { Todo } from '$lib/types';

export function useTodos(status?: string) {
  return cache.query<Todo[]>({
    key: ['todos', { status }],
    fn: () => fetch(`/api/todos?status=${status ?? ''}`).then(r => r.json()),
  });
}
```

### Complementing SvelteKit load()

```ts
// +page.ts (SvelteKit load function — runs on server)
export async function load({ fetch }) {
  const todos = await fetch('/api/todos').then(r => r.json());
  return { todos }; // SSR data
}
```

```svelte
<!-- +page.svelte (client-side — svane takes over for cache/refetch) -->
<script lang="ts">
  import { cache } from '$lib/cache';

  let { data } = $props(); // SSR data from load()

  const todos = cache.query({
    key: 'todos',
    fn: () => fetch('/api/todos').then(r => r.json()),
    // Future v1.2: initialData from load() to hydrate cache
  });
</script>
```

---

## Roadmap

### v1.0 — Core (Ship Target)

- [x] `createCache()` with global config
- [x] `cache.query()` with reactive object return
- [x] `data`, `loading`, `error`, `refetch()`, `isStale`, `isFetching`
- [x] `staleTime`, `refetchInterval`, `refetchOnWindowFocus`, `enabled`
- [x] Retry (default: 1)
- [x] Cache key: string (auto-wraps) or array
- [x] Optional `localStorage` persistence
- [x] TypeScript generics
- [x] Works in `.svelte`, `.svelte.ts`, and `.ts` files

### v1.1 — Mutations & Invalidation

- [ ] `cache.mutate()` primitive
- [ ] Optimistic updates
- [ ] `cache.invalidate(key)` with partial key matching
- [ ] Request deduplication (same key in-flight = one request)

### v1.2 — SSR & Devtools

- [ ] SSR hydration bridge: seed svane cache from SvelteKit `load()` data
- [ ] Browser devtools panel (cache inspector)
- [ ] `cache.prefetch()` for preloading

### v1.3+ — Ecosystem

- [ ] Garbage collection for unused cache entries
- [ ] Infinite query support
- [ ] Pagination helpers
- [ ] Plugin system for custom storage adapters

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Bun |
| **Language** | TypeScript (strict) |
| **Build** | `svelte-package` |
| **Testing** | Vitest + @testing-library/svelte |
| **Package manager** | bun (pnpm acceptable) |
| **Formatting** | Biome / Prettier |
| **CI** | GitHub Actions |
| **npm publish** | `svane` (standalone) + `@complexia/svane` (re-export) |

---

## Competitive Positioning

| Feature | svane | TanStack Svelte Query | Raw fetch + helpers |
|---|---|---|---|
| Svelte 5 runes native | ✅ Built for runes | ⚠️ v6 adapter, thunk syntax | ❌ DIY |
| Zero boilerplate setup | ✅ `createCache()` | ❌ `QueryClientProvider` wrapper | ✅ No setup |
| SvelteKit load() complement | ✅ Designed for it | ⚠️ Possible but awkward | ❌ N/A |
| Caching | ✅ Smart stale-while-revalidate | ✅ Full featured | ❌ None |
| Bundle size | 🪶 Tiny (~2-4kb) | 📦 ~40kb+ (core + adapter) | 🪶 Zero |
| API design | Svelte-idiomatic | React-ported | N/A |
| Works in plain .ts | ✅ | ❌ Needs Svelte context | ✅ |
| Learning curve | Minimal | Moderate | None |

---

## Brand Assets

- **Name:** svane
- **Tagline:** Smart data layer for SvelteKit — fetch, cache, done.
- **Logo concept:** Magnifying glass + lightning bolt (find + speed)
- **Color:** TBD — should complement Svelte orange without clashing
- **Parent brand:** Complexia (complexia.org)

---

*Spec finalized: March 28, 2026*
*Authors: Kal (Complexia) + Claude (Anthropic)*
