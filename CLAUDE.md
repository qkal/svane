# Quelm — CLAUDE.md

## Identity

You are building **Quelm** — a runes-native, SvelteKit-first data fetching & caching library.
Tagline: "Smart data layer for SvelteKit — fetch, cache, done."

## Stack

- Runtime: **Bun** (never npm/yarn — use `bun` for all package management and scripts)
- Language: **TypeScript** (strict mode, no `any`)
- Build: **svelte-package** (`svelte-kit package`)
- Test: **Vitest** + **@testing-library/svelte**
- Formatting: **Biome**

## Architecture

Quelm has a **pure TypeScript core** and a **thin Svelte adapter**:

```
src/
├── core/           # Zero-dependency TS — subscribe/notify reactivity
│   ├── cache.ts    # CacheStore class — Map-based, staleness, persistence
│   ├── query.ts    # QueryRunner — fetch, retry, refetch, polling
│   ├── types.ts    # All interfaces, generics, config types
│   └── storage.ts  # localStorage persistence adapter
├── svelte/         # Thin adapter — bridges core → $state
│   └── adapter.svelte.ts
└── index.ts        # Public API: createCache, types
```

**Critical rule:** `src/core/` must NEVER import from `svelte`, `svelte/store`, or any `.svelte` file. It must be pure TypeScript that runs in any JS environment. The Svelte adapter in `src/svelte/` bridges core events into Svelte 5 `$state` reactivity.

## Public API

### createCache()

```ts
const cache = createCache({
  staleTime?: number,            // default: 30_000 (30s)
  retry?: number,                // default: 1
  refetchOnWindowFocus?: boolean, // default: true
  persist?: Storage,             // default: undefined
});
```

### cache.query()

```ts
const result = cache.query<T>({
  key: string | unknown[],  // string auto-wraps to array
  fn: () => Promise<T>,
  staleTime?: number,
  refetchInterval?: number,
  enabled?: boolean | (() => boolean),
});
```

Returns a reactive object:
- `result.status: 'idle' | 'loading' | 'refreshing' | 'success' | 'error'`
- `result.data: T | undefined`
- `result.error: Error | null`
- `result.isStale: boolean`
- `result.refetch(): Promise<void>`

> Note: `status` replaces the `loading`/`isFetching` booleans from the original spec.
> The status discriminant prevents impossible states (e.g., `loading: true` AND `isFetching: true`).

## Code Conventions

- All exports must have JSDoc comments with `@example` blocks
- Use `interface` over `type` for public API shapes
- Internal state uses `private` class fields
- Test file naming: `*.test.ts` for core, `*.test.svelte.ts` for adapter
- Cache keys: always normalize to array internally using `normalizeKey()`
- Error handling: wrap all fetch calls, never let unhandled rejections escape

## Testing Rules

- Every public API function must have unit tests
- Core tests must NOT import Svelte — they run without the compiler
- Svelte adapter tests use @testing-library/svelte with fake timers
- Use `vi.useFakeTimers()` for staleTime/refetchInterval tests
- Mock `fetch` with `vi.fn()`, never hit real endpoints

## What NOT to Do

- Do NOT add `QueryClientProvider` or any wrapper component — Quelm uses explicit `createCache()`
- Do NOT use Svelte stores (`writable`, `readable`) — this is runes-only (Svelte 5+)
- Do NOT use `$:` reactive declarations — runes only (`$state`, `$derived`, `$effect`)
- Do NOT add dependencies unless absolutely necessary — Quelm should be zero-dep
- Do NOT use `createQuery()` naming — Quelm uses `cache.query()` to differentiate from TanStack
