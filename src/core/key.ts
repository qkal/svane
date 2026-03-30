/**
 * Normalizes a cache key to array form.
 * String keys are wrapped in an array; array keys are returned as-is.
 *
 * @example
 * normalizeKey('todos')                          // → ['todos']
 * normalizeKey(['todos', { status: 'active' }])  // → ['todos', { status: 'active' }]
 */
export function normalizeKey(key: string | unknown[]): unknown[] {
  return typeof key === 'string' ? [key] : key;
}

/**
 * Serializes a normalized key to a stable string suitable for use as a Map key.
 *
 * @example
 * serializeKey(['todos'])                         // → '["todos"]'
 * serializeKey(['todos', { status: 'active' }])   // → '["todos",{"status":"active"}]'
 */
export function serializeKey(key: unknown[]): string {
  return JSON.stringify(key);
}

/**
 * Checks whether `partial` is a prefix of `full`. Used for partial key matching
 * in future invalidation support (v1.1+).
 *
 * @example
 * matchesKey(['todos'], ['todos', { status: 'active' }])  // → true
 * matchesKey(['posts'], ['todos'])                         // → false
 */
export function matchesKey(partial: unknown[], full: unknown[]): boolean {
  if (partial.length > full.length) return false;
  for (let i = 0; i < partial.length; i++) {
    const p = partial[i];
    const f = full[i];
    if (p === f) continue;
    if (JSON.stringify(p) !== JSON.stringify(f)) return false;
  }
  return true;
}
