# svane — Single-Shot Build Prompt (Codex CLI / Generic Agents)

Use this when you want an agent to scaffold or build svane in a single pass.
Optimized for Codex CLI, Gemini CLI, or any agentic coding tool.

---

## The Prompt

```
Build a TypeScript library called "svane" — a data fetching & caching library for SvelteKit.

STACK: Bun (package manager + runtime), TypeScript strict, svelte-package (build), Vitest (test)

ARCHITECTURE:
- src/core/ → pure TypeScript, ZERO svelte imports. Subscribe/notify reactivity.
- src/svelte/ → thin adapter that bridges core → Svelte 5 $state via getters.
- src/index.ts → public API exports.

PUBLIC API:

```ts
import { createCache } from 'svane';

// 1. Create cache (once per app)
const cache = createCache({
  staleTime: 30_000,        // ms until data is stale (default: 30s)
  retry: 1,                  // retry count on failure (default: 1)
  refetchOnWindowFocus: true, // refetch stale on tab focus (default: true)
  persist: localStorage,      // optional Storage for persistence
});

// 2. Query (in any .ts, .svelte.ts, or .svelte file)
const todos = cache.query<Todo[]>({
  key: 'todos',              // string auto-wraps to array
  fn: () => fetch('/api/todos').then(r => r.json()),
  staleTime: 60_000,         // per-query override
  refetchInterval: 5_000,    // polling
  enabled: true,             // conditional execution
});

// 3. Reactive object (getters for Svelte 5 reactivity)
todos.data        // T | undefined
todos.loading     // boolean (first fetch, no cache)
todos.error       // Error | null
todos.isStale     // boolean
todos.isFetching  // boolean (background refetch)
todos.refetch()   // manual trigger
```

FILES TO CREATE:

src/core/types.ts — All interfaces: CacheConfig, QueryConfig<T>, QueryState<T>, CacheEntry<T>. Export default constants.
src/core/key.ts — normalizeKey(string|array → array), serializeKey(array → string for Map key).
src/core/storage.ts — persistCache() and hydrateCache() for localStorage round-trip. Handle JSON errors gracefully.
src/core/cache.ts — CacheStore class. Internal Map<string, CacheEntry>. get/set/isStale/delete/clear. Subscribe/notify per key. Hydrate from storage on init, persist on write.
src/core/query.ts — QueryRunner<T> class. Orchestrates: check cache → fetch if needed → retry on error → refetchInterval → visibilitychange listener. Exposes subscribe(), getState(), refetch(), destroy().
src/svelte/adapter.svelte.ts — createReactiveQuery<T>(runner) → object with $state + getters. Under 50 lines.
src/index.ts — Export createCache function + all public types.

CONSTRAINTS:
- Zero dependencies (only peerDependency: svelte ^5.25.0)
- src/core/ must NEVER import from 'svelte'
- Use getter properties on returned object (NOT destructurable $state — that breaks reactivity)
- No QueryClientProvider wrapper component — svane uses explicit createCache()
- No Svelte stores (writable/readable) — runes only ($state, $derived, $effect)
- No $: reactive declarations — Svelte 5 runes only
- Every public export must have JSDoc with @example

TESTS (use Vitest + vi.useFakeTimers + vi.fn for fetch mock):
- key.test.ts: normalization, serialization, matching
- storage.test.ts: round-trip, empty storage, corrupted JSON
- cache.test.ts: get/set, staleness with fake timers, subscriber notification, persistence
- query.test.ts: loading→success, stale-while-revalidate, retry, polling, window focus, enabled=false, destroy cleanup

PACKAGE.JSON:
- name: "svane"
- Use "svelte" and "types" in exports map
- Build script: "package": "svelte-kit sync && svelte-package"
- peerDependencies: { "svelte": "^5.25.0" }
```

---

## Notes for Use

**With Codex CLI:**
```bash
codex --prompt "$(cat CODEX-PROMPT.md)"
```

**With Gemini CLI:**
```bash
gemini -p "$(cat CODEX-PROMPT.md)"
```

**With Claude Code:**
Prefer the phased `svane-BUILD-PROMPT.md` instead — it gives Claude Code more structure and verification checkpoints between phases. Use this single-shot version only if you want to scaffold everything at once and verify manually.
