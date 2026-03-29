import type { CacheEntry } from './types';

const STORAGE_KEY = 'quelm-cache';

/**
 * Persists the entire cache entry Map to storage under a single key.
 * Silently fails on quota errors, private mode, or other storage exceptions.
 *
 * @example
 * persistCache(localStorage, cacheEntries);
 */
export function persistCache(storage: Storage, entries: Map<string, CacheEntry>): void {
  try {
    const serialized = JSON.stringify(Object.fromEntries(entries));
    storage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Best-effort — quota exceeded, private mode, etc.
  }
}

/**
 * Hydrates a cache entry Map from storage.
 * Returns an empty Map if storage is empty, missing, or contains invalid JSON.
 *
 * @example
 * const entries = hydrateCache(localStorage);
 */
export function hydrateCache(storage: Storage): Map<string, CacheEntry> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    return new Map(Object.entries(parsed) as [string, CacheEntry][]);
  } catch {
    return new Map();
  }
}
