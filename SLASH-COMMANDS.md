# svane — Claude Code Slash Commands

Save these as `.claude/commands/` in your svane project root.
Each file becomes a `/command` in Claude Code.

---

## `.claude/commands/test.md`

```markdown
Run all svane tests and report results.

<instructions>
1. Run `bun run test` and show the full output
2. If any tests fail:
   - Identify the failing test and the assertion that broke
   - Read the relevant source file
   - Fix the issue
   - Re-run tests to confirm the fix
3. After all tests pass, verify the core/ directory has zero svelte imports:
   `grep -r "from 'svelte" src/core/ || echo "Clean — no svelte imports in core/"`
4. Report: total tests, passed, failed, and any fixes applied
</instructions>
```

---

## `.claude/commands/add-query-option.md`

```markdown
Add a new configuration option to svane's query() API.

<instructions>
Think step-by-step:

1. First, read `src/core/types.ts` to understand existing types
2. Add the new option to `QueryConfig<T>` interface with JSDoc + @example
3. Add a default value to the defaults constants
4. Implement the behavior in `src/core/query.ts` — follow the patterns of existing options
5. Update `src/core/types.ts` QueryState if the option adds new state
6. If the option affects the Svelte adapter, update `src/svelte/adapter.svelte.ts`
7. Write at least 3 tests:
   - Default behavior (option not set)
   - Option explicitly set
   - Edge case (e.g., invalid value, boundary condition)
8. Run `bun run test` to verify nothing broke
9. Update the JSDoc on `createCache` and `cache.query` if applicable

The new option name and behavior will be specified by the user as: $ARGUMENTS
</instructions>
```

---

## `.claude/commands/check-architecture.md`

```markdown
Verify svane's architectural invariants.

<instructions>
Run these checks in order and report pass/fail for each:

1. **Core purity**: `grep -rn "from 'svelte\|from \"svelte\|import.*svelte" src/core/`
   - MUST return zero matches. Core must be pure TypeScript.

2. **Zero dependencies**: Check package.json `dependencies` field
   - MUST be empty or not present. Only peerDependencies and devDependencies allowed.

3. **Type exports**: Verify `src/index.ts` exports these exact public types:
   - `createCache` (function)
   - `CacheConfig` (interface)
   - `QueryConfig` (interface)
   - `QueryResult` (interface)

4. **No stores**: `grep -rn "writable\|readable\|derived.*from.*svelte/store" src/`
   - MUST return zero matches. svane uses runes only.

5. **No $: syntax**: `grep -rn "^\s*\$:" src/`
   - MUST return zero matches. Runes only, no legacy reactive declarations.

6. **Test coverage**: `bun run test --reporter=verbose`
   - Report total test count per file

7. **Build check**: `bun run package`
   - Must complete without errors
   - Report dist/ file count and total size

Report results as a checklist with ✅ or ❌ for each check.
</instructions>
```

---

## `.claude/commands/new-test.md`

```markdown
Write tests for a svane module.

<instructions>
The user will specify which module to test as: $ARGUMENTS

Steps:
1. Read the source file to understand all public methods and behaviors
2. Identify untested or under-tested scenarios by reading existing tests
3. Write new tests following these conventions:
   - Use `describe()` blocks grouped by method/behavior
   - Use `vi.useFakeTimers()` for any time-dependent tests
   - Mock `fetch` with `vi.fn()` — never hit real endpoints
   - Mock `document.addEventListener` for browser API tests
   - Use descriptive test names: "should [behavior] when [condition]"
   - For core/ tests: import ONLY from src/core/, never from svelte
   - For svelte/ tests: use @testing-library/svelte with render()

4. Run the tests: `bun run test [specific file]`
5. Fix any failures
6. Report what scenarios were added

<test_example>
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CacheStore } from '../src/core/cache';

describe('CacheStore', () => {
  let cache: CacheStore;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new CacheStore({ staleTime: 30_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isStale', () => {
    it('should return false for fresh data', () => {
      cache.set('key', { value: 1 });
      expect(cache.isStale('key', 30_000)).toBe(false);
    });

    it('should return true after staleTime elapses', () => {
      cache.set('key', { value: 1 });
      vi.advanceTimersByTime(30_001);
      expect(cache.isStale('key', 30_000)).toBe(true);
    });
  });
});
</test_example>
</instructions>
```

---

## `.claude/commands/refactor.md`

```markdown
Refactor a svane module while preserving behavior.

<instructions>
The user will specify the module and goal as: $ARGUMENTS

Steps:
1. Read the current source file completely
2. Read ALL tests for this module
3. Run tests BEFORE refactoring: `bun run test` — note pass count
4. Plan the refactor:
   <thinking>
   - What is the current structure?
   - What improvement is requested?
   - Which tests verify the behavior I must preserve?
   - Are there any edge cases the tests might not cover?
   </thinking>
5. Apply the refactor
6. Run tests AFTER: `bun run test` — same pass count or higher
7. Verify architecture: no svelte imports in core/
8. If any test fails: the refactor broke behavior — revert and try again

CRITICAL: Never change public API signatures during a refactor.
If the refactor requires API changes, stop and ask the user first.
</instructions>
```

---

## `.claude/commands/doc.md`

```markdown
Generate or update documentation for svane.

<instructions>
The user will specify what to document as: $ARGUMENTS

For JSDoc updates:
1. Read the source file
2. Add/update JSDoc on every exported function, class, interface, and type
3. Every JSDoc must include:
   - A one-line description
   - `@param` for each parameter with type and description
   - `@returns` with type and description
   - `@example` with a realistic usage example
   - `@since` version tag (use 0.1.0 for initial)

For README updates:
1. Read the current README.md
2. Read src/index.ts to verify the public API matches docs
3. Update code examples to match current API exactly
4. Verify all examples are syntactically valid TypeScript/Svelte

For CHANGELOG:
1. Read recent git commits: `git log --oneline -20`
2. Group changes by: Added, Changed, Fixed, Removed
3. Follow Keep a Changelog format
</instructions>
```
