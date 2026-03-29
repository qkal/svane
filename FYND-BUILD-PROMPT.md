<svane_build_prompt>

<role>
You are a senior TypeScript library architect building svane — a runes-native, SvelteKit-first data fetching & caching library. You write minimal, zero-dependency code with full type safety. You think in terms of subscribe/notify patterns for the core and Svelte 5 runes ($state, $derived, $effect) for the adapter layer.
</role>

<context>
svane exists because TanStack Query's Svelte adapter feels ported from React — it requires QueryClientProvider wrappers, thunk syntax, and took 18+ months to support Svelte 5 runes. Developers are rolling their own fetch helpers but they lack caching, staleness tracking, and refetching.

svane is different:
- Pure TS core (no Svelte compiler dependency) + thin Svelte adapter
- Simple `cache.query()` API returning a reactive object
- Complements SvelteKit's load() — doesn't replace it
- Zero dependencies
- Works in .svelte, .svelte.ts, AND plain .ts files

Stack: Bun, TypeScript strict, svelte-package, Vitest, Biome
</context>

<architecture>
svane/
├── src/
│   ├── core/                    # Pure TypeScript — NEVER imports svelte
│   │   ├── types.ts             # All interfaces, generics, config types
│   │   ├── cache.ts             # CacheStore — Map + staleness + persistence
│   │   ├── query.ts             # QueryRunner — fetch, retry, polling, window focus
│   │   ├── key.ts               # Key normalization + serialization + matching
│   │   └── storage.ts           # localStorage adapter (serialize/deserialize)
│   ├── svelte/                  # Thin adapter — core events → $state
│   │   └── adapter.svelte.ts    # Bridges QueryRunner signals to reactive getters
│   └── index.ts                 # Public API re-exports
├── tests/
│   ├── core/                    # Pure Vitest — no Svelte compiler
│   │   ├── cache.test.ts
│   │   ├── query.test.ts
│   │   ├── key.test.ts
│   │   └── storage.test.ts
│   └── svelte/                  # @testing-library/svelte
│       └── adapter.test.svelte.ts
├── package.json
├── svelte.config.js
├── tsconfig.json
├── vitest.config.ts
├── biome.json
├── CLAUDE.md
└── README.md
</architecture>

<api_specification>
<!-- This is the EXACT API surface. Do not deviate. -->

<setup>
import { createCache } from 'svane';

const cache = createCache({
  staleTime: 30_000,           // default: 30s
  retry: 1,                    // default: 1
  refetchOnWindowFocus: true,  // default: true
  persist: localStorage,       // optional, default: undefined
});
</setup>

<query>
const todos = cache.query<Todo[]>({
  key: 'todos',                         // string (auto-wraps to ['todos'])
  // key: ['todos', { status: 'active' }], // or array
  fn: () => fetch('/api/todos').then(r => r.json()),

  // Per-query overrides (all optional):
  staleTime: 60_000,
  refetchInterval: 5_000,
  enabled: true,
});
</query>

<return_shape>
interface QueryResult<T> {
  readonly data: T | undefined;
  readonly loading: boolean;       // true on first fetch (no cache)
  readonly error: Error | null;
  readonly isStale: boolean;       // data older than staleTime
  readonly isFetching: boolean;    // background refetch in progress
  refetch(): Promise<void>;
}
</return_shape>

<key_behaviors>
- loading=true ONLY on first fetch with no cached data
- isFetching=true during background refetch (stale data still visible)
- staleTime default is 30_000ms (30s) — NOT 0 like TanStack
- retry default is 1 — fail fast
- refetchOnWindowFocus uses document 'visibilitychange' event
- refetchInterval uses setInterval + refetch()
- enabled=false prevents query execution until it becomes true
- Cache keys: string auto-wraps to [string]. Arrays are serialized via JSON.stringify for Map keys
- Persistence: on cache init, hydrate from storage. On every cache write, persist to storage.
</key_behaviors>
</api_specification>

<!-- ============================================================ -->
<!--                     PHASE 1: FOUNDATION                       -->
<!-- ============================================================ -->

<phase id="1" name="Foundation — Types, Key Utils, and Project Scaffold">
<goal>Set up the project and define all TypeScript types and the key normalization utility.</goal>

<tasks>
1. Initialize the project:
   - `bun init` with TypeScript
   - Install dev dependencies: `svelte`, `@sveltejs/kit`, `@sveltejs/package`, `vitest`, `@testing-library/svelte`, `@biomejs/biome`
   - Configure `tsconfig.json` with strict mode
   - Configure `svelte.config.js` for library mode
   - Configure `vitest.config.ts` with workspace for core and svelte tests
   - Configure `biome.json`
   - Set up `package.json` exports map with `svelte` condition

2. Create `src/core/types.ts`:
   - `CacheConfig` interface (staleTime, retry, refetchOnWindowFocus, persist)
   - `QueryConfig<T>` interface (key, fn, staleTime?, refetchInterval?, enabled?)
   - `QueryState<T>` interface (data, loading, error, isStale, isFetching)
   - `CacheEntry<T>` interface (data, timestamp, error)
   - `QuerySubscriber` callback type
   - All defaults as exported constants: `DEFAULT_STALE_TIME = 30_000`, etc.

3. Create `src/core/key.ts`:
   - `normalizeKey(key: string | unknown[]): unknown[]` — wraps string to array
   - `serializeKey(key: unknown[]): string` — stable JSON.stringify for Map keys
   - `matchesKey(partial: unknown[], full: unknown[]): boolean` — for future invalidation

4. Write tests for `key.ts`:
   - String wrapping: `normalizeKey('todos')` → `['todos']`
   - Array passthrough: `normalizeKey(['todos', { status: 'active' }])` → same
   - Serialization determinism: same input always same string
   - Matching: `['todos']` matches `['todos', { status: 'active' }]`
</tasks>

<success_criteria>
- `bun run check` passes (TypeScript compiles clean)
- `bun run test` passes all key.test.ts tests
- `bun run lint` passes (Biome)
- Zero dependencies in the `dependencies` field of package.json
</success_criteria>
</phase>

<!-- ============================================================ -->
<!--                     PHASE 2: CORE CACHE                       -->
<!-- ============================================================ -->

<phase id="2" name="Core Cache — CacheStore Implementation">
<goal>Implement the in-memory cache store with staleness tracking and the persistence adapter.</goal>

<tasks>
1. Create `src/core/storage.ts`:
   - `persistCache(storage: Storage, key: string, data: unknown): void`
   - `hydrateCache(storage: Storage): Map<string, CacheEntry>` 
   - Handle JSON parse errors gracefully (corrupted storage → empty cache)
   - Use a single storage key like `'svane-cache'` for all entries

2. Create `src/core/cache.ts` — the `CacheStore` class:
   - Internal `Map<string, CacheEntry<unknown>>` for cached data
   - `get(key: string): CacheEntry | undefined`
   - `set(key: string, data: unknown): void` — stores with timestamp
   - `isStale(key: string, staleTime: number): boolean` — checks timestamp vs now
   - `delete(key: string): void`
   - `clear(): void`
   - Subscribe/notify pattern: components subscribe to key changes
   - On construction: hydrate from `persist` storage if provided
   - On every `set()`: persist to storage if configured

3. Write comprehensive tests for `cache.ts`:
   - Set and get data
   - Staleness detection with fake timers
   - Subscriber notification on set/delete
   - Persistence: set → read from mock storage
   - Hydration: pre-populated storage → cache has data on init
   - Corrupted storage doesn't crash

4. Write tests for `storage.ts`:
   - Round-trip: persist → hydrate
   - Empty storage → empty Map
   - Invalid JSON → empty Map (graceful)
</tasks>

<success_criteria>
- All cache.test.ts and storage.test.ts pass
- CacheStore has zero imports from 'svelte'
- Subscriber pattern works: set() triggers all subscribers for that key
- Fake timer tests prove staleness detection works correctly
</success_criteria>
</phase>

<!-- ============================================================ -->
<!--                     PHASE 3: QUERY RUNNER                     -->
<!-- ============================================================ -->

<phase id="3" name="Query Runner — Fetch, Retry, Polling, Window Focus">
<goal>Implement the QueryRunner that orchestrates fetching, caching, retrying, and refetching.</goal>

<tasks>
1. Create `src/core/query.ts` — the `QueryRunner<T>` class:

   Constructor takes `CacheStore`, `QueryConfig<T>`, and resolved `CacheConfig`.

   Core flow:
   ```
   a) Check cache for existing data
   b) If cached + fresh → return cached, don't fetch
   c) If cached + stale → return cached, trigger background refetch (isFetching=true)
   d) If no cache → fetch (loading=true)
   e) On fetch success → update cache, notify subscribers
   f) On fetch error → retry up to config.retry times, then set error state
   ```

   Implement these behaviors:
   - `execute(): void` — main fetch logic with retry
   - `refetch(): Promise<void>` — public manual refetch
   - `destroy(): void` — cleanup intervals, listeners
   - `subscribe(cb: QuerySubscriber): () => void` — returns unsubscribe fn
   - `getState(): QueryState<T>` — current snapshot

   Implement these features:
   - **Retry**: on error, retry up to `config.retry` times with simple delay (300ms * attempt)
   - **Polling**: if `refetchInterval` set, `setInterval` that calls `refetch()`
   - **Window focus**: if `refetchOnWindowFocus`, add `visibilitychange` listener that refetches stale queries
   - **Enabled**: if `enabled === false`, don't execute. Watch for changes (caller must re-call with enabled=true)

2. Write thorough tests for `query.ts`:

   <test_scenarios>
   - First fetch: loading=true → success → loading=false, data set
   - Cached fresh data: no fetch triggered, data returned immediately
   - Cached stale data: data returned + background refetch (isFetching=true)
   - Fetch error: retry once, then error set
   - Fetch error: retry exhausted → error state
   - refetch(): triggers new fetch regardless of staleness
   - refetchInterval: fetch fires on interval (fake timers)
   - refetchOnWindowFocus: simulated visibilitychange triggers refetch for stale data
   - enabled=false: no fetch executed
   - destroy(): clears intervals and event listeners
   </test_scenarios>

   Use `vi.useFakeTimers()` for all time-dependent tests.
   Mock `fetch` with `vi.fn()`.
   Mock `document.addEventListener` for visibility tests.
</tasks>

<success_criteria>
- All query.test.ts scenarios pass
- QueryRunner has zero imports from 'svelte'
- Retry logic is tested with exact attempt counts
- Polling cleanup is verified (no interval leaks after destroy())
- Window focus listener is removed on destroy()
</success_criteria>
</phase>

<!-- ============================================================ -->
<!--                     PHASE 4: SVELTE ADAPTER                   -->
<!-- ============================================================ -->

<phase id="4" name="Svelte Adapter — Bridge Core to $state">
<goal>Create the thin Svelte adapter that makes QueryRunner reactive using Svelte 5 runes.</goal>

<tasks>
1. Create `src/svelte/adapter.svelte.ts`:

   This file bridges the core's subscribe/notify pattern into Svelte 5 reactivity.

   ```ts
   // Pseudocode — adapt to actual implementation
   export function createReactiveQuery<T>(runner: QueryRunner<T>) {
     // Use $state for reactive properties
     let state = $state<QueryState<T>>(runner.getState());

     // Subscribe to runner changes → update $state
     const unsubscribe = runner.subscribe((newState) => {
       state = newState;
     });

     // Return object with getters that read from $state
     // This ensures reactivity works when accessed as result.data, result.loading etc.
     return {
       get data() { return state.data; },
       get loading() { return state.loading; },
       get error() { return state.error; },
       get isStale() { return state.isStale; },
       get isFetching() { return state.isFetching; },
       refetch: () => runner.refetch(),
     };
   }
   ```

   Key considerations:
   - The returned object uses **getters** so that accessing `.data` reads from `$state` (reactive)
   - Do NOT destructure $state — use getters to maintain reactivity
   - Handle cleanup: when the component unmounts, unsubscribe from runner

2. Create `src/index.ts` — the public API:

   ```ts
   export function createCache(config?: Partial<CacheConfig>) {
     const resolvedConfig = { ...DEFAULTS, ...config };
     const store = new CacheStore(resolvedConfig);

     return {
       query<T>(queryConfig: QueryConfig<T>) {
         const runner = new QueryRunner<T>(store, queryConfig, resolvedConfig);
         return createReactiveQuery(runner);
       },
       // Future: mutate(), invalidate(), prefetch()
     };
   }

   export type { CacheConfig, QueryConfig, QueryResult } from './core/types';
   ```

3. Write Svelte adapter tests:
   - Mount a test component that uses cache.query()
   - Verify loading → data transition renders correctly
   - Verify error state renders
   - Verify refetch() triggers re-render with new data
</tasks>

<success_criteria>
- `import { createCache } from 'svane'` works
- Reactive getters maintain Svelte 5 reactivity (no destructuring footgun)
- Component tests pass with @testing-library/svelte
- The adapter file is under 50 lines of code (it should be thin)
</success_criteria>
</phase>

<!-- ============================================================ -->
<!--                     PHASE 5: POLISH & PUBLISH                 -->
<!-- ============================================================ -->

<phase id="5" name="Polish — README, Package Config, Build Verification">
<goal>Prepare for npm publish with proper package.json, README, and build verification.</goal>

<tasks>
1. Configure `package.json`:
   ```json
   {
     "name": "svane",
     "version": "0.1.0",
     "description": "Smart data layer for SvelteKit — fetch, cache, done.",
     "license": "MIT",
     "type": "module",
     "svelte": "./dist/index.js",
     "types": "./dist/index.d.ts",
     "exports": {
       ".": {
         "svelte": "./dist/index.js",
         "types": "./dist/index.d.ts",
         "default": "./dist/index.js"
       }
     },
     "files": ["dist"],
     "peerDependencies": {
       "svelte": "^5.25.0"
     },
     "keywords": ["svelte", "sveltekit", "query", "cache", "fetch", "runes", "data-fetching"],
     "repository": { "type": "git", "url": "https://github.com/<username>/svane" }
   }
   ```

2. Write README.md:
   - Badge row (npm version, bundle size, license)
   - Tagline + one-paragraph description
   - "Why svane?" section (3 bullet comparison vs TanStack, vs raw fetch)
   - Quick Start (install → createCache → query → template)
   - API Reference (createCache options, query options, return shape)
   - Examples (basic, polling, dependent queries, reusable .svelte.ts)
   - Roadmap (v1.1 mutations, v1.2 SSR bridge)
   - Contributing section
   - License

3. Build and verify:
   - `bun run package` builds to `dist/`
   - `bun run check` passes
   - `bun run test` — all tests pass
   - `bun run lint` — Biome clean
   - Manually verify: dist/ contains .js, .d.ts files with correct exports
   - Verify bundle size target: core < 4kb minified

4. Create CHANGELOG.md with v0.1.0 entry

5. Create LICENSE (MIT)
</tasks>

<success_criteria>
- `bun run package && bun run check && bun run test && bun run lint` all pass in sequence
- README is complete with working code examples
- Package exports resolve correctly when imported
- dist/ output is clean, minimal, and contains no test files
</success_criteria>
</phase>

<execution_rules>
1. Execute phases IN ORDER — do not skip ahead
2. After each phase, run ALL tests and type checks before proceeding
3. If a test fails, fix it before moving to the next task
4. The core/ directory must NEVER import from 'svelte' — verify after every phase
5. Every public function must have JSDoc with @example
6. Use `interface` for public types, `type` for internal aliases
7. Prefer explicit over clever — this is a library, readability is paramount
8. When in doubt about API design, refer back to <api_specification>
</execution_rules>

</svane_build_prompt>
