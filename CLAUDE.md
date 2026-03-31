# Kvale — CLAUDE.md

## Identity

You are building **Kvale** — a runes-native, SvelteKit-first data fetching & caching library.
Tagline: "Smart data layer for SvelteKit — fetch, cache, done."

## Stack

- Runtime: **Bun** (never npm/yarn — use `bun` for all package management and scripts)
- Language: **TypeScript** (strict mode, no `any`)
- Build: **svelte-package** (`svelte-kit package`)
- Test: **Vitest** + **@testing-library/svelte**
- Formatting: **Biome**

## Architecture

Kvale has a **pure TypeScript core** and a **thin Svelte adapter**:

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

- Do NOT add `QueryClientProvider` or any wrapper component — Kvale uses explicit `createCache()`
- Do NOT use Svelte stores (`writable`, `readable`) — this is runes-only (Svelte 5+)
- Do NOT use `$:` reactive declarations — runes only (`$state`, `$derived`, `$effect`)
- Do NOT add dependencies unless absolutely necessary — Kvale should be zero-dep
- Do NOT use `createQuery()` naming — Kvale uses `cache.query()` to differentiate from TanStack

# Instrukcje dotyczące zarządzania i aktualizacji pakietu NPM

Jako agent odpowiedzialny za rozwój tego projektu, przestrzegaj poniższych zasad podczas wdrażania aktualizacji do rejestru npm:

### 1. Niezmienność wersji (Immutability)
* Nigdy nie próbuj nadpisywać opublikowanej już wersji pakietu. 
* Każda zmiana w kodzie, dokumentacji (README) lub metadanych wymaga opublikowania nowej wersji z podbitym numerem wersji.

### 2. Semantyczne wersjonowanie (SemVer)
Zawsze dobieraj typ aktualizacji zgodnie ze schematem `MAJOR.MINOR.PATCH`:
* **PATCH**: Poprawki błędów (bugfixy), które nie zmieniają API i są w pełni kompatybilne wstecz.
* **MINOR**: Dodanie nowej funkcjonalności w sposób kompatybilny wstecz.
* **MAJOR**: Zmiany łamiące kompatybilność (breaking changes), wymagające od użytkownika modyfikacji jego kodu.

### 3. Procedura publikacji (Workflow)
Przed publikacją upewnij się, że lokalne repozytorium git jest "czyste" (wszystkie zmiany zatwierdzone). Wykonuj kroki w następującej kolejności:
1. **Automatyczne podbicie wersji**: Używaj komendy `npm version [patch|minor|major]`. To automatycznie zaktualizuje `package.json` i stworzy tag w git.
2. **Publikacja**: Wykonaj `npm publish`.
3. **Synchronizacja**: Wyślij tagi do zdalnego repozytorium za pomocą `git push --follow-tags`.

### 4. Bezpieczeństwo i Integralność (Lifecycle Scripts)
* Przed każdą publikacją muszą zostać uruchomione testy i proces budowania (jeśli dotyczy).
* W `package.json` powinien znajdować się skrypt `"prepublishOnly"`, który automatyzuje te kroki (np. `npm run test && npm run build`) lub zamienników npm test, czyli na przykład bun test. Jeśli testy zawiodą, publikacja musi zostać przerwana.

### 5. Kontrola zawartości pakietu
* Do rejestru npm wysyłaj tylko niezbędne pliki (np. folder `dist/`, `README.md`, `LICENSE`).
* Używaj pola `"files"` w `package.json` do białej listy plików lub pliku `.npmignore` do czarnej listy (np. wykluczając testy, pliki konfiguracyjne IDE, kod źródłowy TS).

### 6. Dokumentacja zmian
* Po każdej aktualizacji typu MINOR lub MAJOR upewnij się, że plik `CHANGELOG.md` został zaktualizowany o opis wprowadzonych zmian.
