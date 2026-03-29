import type { CacheStore } from './cache';
import { normalizeKey, serializeKey } from './key';
import type { CacheConfig, QueryConfig, QueryState, QuerySubscriber } from './types';

/**
 * Orchestrates the full query lifecycle: cache lookup, fetch, retry, polling,
 * window focus refetch, and subscriber notifications.
 *
 * @example
 * const runner = new QueryRunner(store, { key: 'todos', fn }, cacheConfig);
 * runner.execute(); // starts the query
 * runner.destroy(); // cleans up intervals and listeners
 */
export class QueryRunner<T, U = T> {
  private readonly serializedKey: string;
  private readonly staleTime: number;
  private state: QueryState<T>;
  private readonly subscribers: Set<QuerySubscriber<T>> = new Set();
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private visibilityHandler: (() => void) | undefined;
  private sideEffectsSetUp = false;
  private destroyed = false;
  private abortController: AbortController | undefined;

  constructor(
    private readonly store: CacheStore,
    private readonly config: QueryConfig<T, U>,
    private readonly cacheConfig: CacheConfig,
    /** Previous data to show while loading (used by adapter for keepPreviousData). */
    private readonly previousData?: T,
  ) {
    const key = typeof config.key === 'function' ? config.key() : config.key;
    const normalized = normalizeKey(key);
    this.serializedKey = serializeKey(normalized);
    this.staleTime = config.staleTime ?? cacheConfig.staleTime;

    const cached = store.get(this.serializedKey);
    const isStale = store.isStale(this.serializedKey, this.staleTime);

    this.state = {
      status: 'idle',
      data: cached?.data as T | undefined,
      error: null,
      isStale,
    };
  }

  /**
   * Reads the `enabled` option. Calls it if it's a getter function.
   * Returns `true` when `enabled` is undefined (default).
   * Returns `false` if the getter throws.
   */
  isEnabled(): boolean {
    try {
      const { enabled } = this.config;
      if (enabled === undefined) return true;
      return typeof enabled === 'function' ? enabled() : enabled;
    } catch {
      return false;
    }
  }

  /** Returns the serialized key for this runner. */
  getSerializedKey(): string {
    return this.serializedKey;
  }

  /** Returns a copy of the current query state. */
  getState(): QueryState<T> {
    return { ...this.state };
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(callback: QuerySubscriber<T>): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Starts the query. Checks the cache, sets initial status, and triggers
   * a fetch if needed. Also sets up polling and window focus listeners.
   * Registers with the store for gcTime tracking.
   * No-op if disabled or already destroyed.
   */
  execute(): void {
    if (this.destroyed || !this.isEnabled()) return;

    this.store.registerKey(this.serializedKey);

    const cached = this.store.get(this.serializedKey);
    const isStale = this.store.isStale(this.serializedKey, this.staleTime);

    if (cached && !isStale) {
      this.setState({ status: 'success', data: cached.data as T, error: null, isStale: false });
      this.setupSideEffects();
      return;
    }

    if (cached && isStale) {
      this.setState({ status: 'refreshing', data: cached.data as T, error: null, isStale: true });
      void this.fetchWithRetry();
      this.setupSideEffects();
      return;
    }

    // No cache hit — use previousData if keepPreviousData is set
    if (this.config.keepPreviousData && this.previousData !== undefined) {
      this.setState({ status: 'refreshing', data: this.previousData, error: null, isStale: false });
    } else {
      this.setState({ status: 'loading', data: undefined, error: null, isStale: false });
    }
    void this.fetchWithRetry();
    this.setupSideEffects();
  }

  /**
   * Manually triggers a refetch regardless of staleness.
   * Sets status to 'refreshing' if data already exists, otherwise 'loading'.
   */
  async refetch(): Promise<void> {
    if (this.destroyed) return;
    this.setState({
      ...this.state,
      status: this.state.data !== undefined ? 'refreshing' : 'loading',
    });
    await this.fetchWithRetry();
  }

  /**
   * Clears intervals, removes event listeners, aborts in-flight request,
   * and unregisters from the store for gcTime tracking.
   * Called automatically by the Svelte adapter on component unmount.
   */
  destroy(): void {
    this.destroyed = true;
    this.abortController?.abort();
    this.abortController = undefined;
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    if (this.visibilityHandler) {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.visibilityHandler);
      }
      this.visibilityHandler = undefined;
    }
    this.subscribers.clear();
    this.store.unregisterKey(this.serializedKey);
  }

  /**
   * Resets the destroyed and sideEffectsSetUp flags, allowing re-execution
   * after a cleanup cycle. Called by the Svelte adapter when the `enabled`
   * condition transitions back to true after a previous cleanup.
   */
  reset(): void {
    this.destroyed = false;
    this.sideEffectsSetUp = false;
  }

  private async fetchWithRetry(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Deduplication: attach to existing full-retry-chain promise if present
    const existing = this.store.getInFlight(this.serializedKey);
    if (existing) {
      try {
        const data = await (existing as Promise<T>);
        if (this.destroyed || signal.aborted) return;
        this.setState({ status: 'success', data, error: null, isStale: false });
      } catch (err) {
        if (this.destroyed || signal.aborted) return;
        const error = err instanceof Error ? err : new Error(String(err));
        this.setState({ ...this.state, status: 'error', error });
      }
      return;
    }

    // Build the full retry-chain promise (resolves with T or rejects after all retries)
    const retryChain = this.executeWithRetry(0, signal);
    this.store.setInFlight(this.serializedKey, retryChain, this.abortController);

    try {
      const data = await retryChain;
      this.store.clearInFlight(this.serializedKey);
      if (this.destroyed || signal.aborted) return;
      this.store.set(this.serializedKey, { data, timestamp: Date.now(), error: null });
      this.setState({ status: 'success', data, error: null, isStale: false });
    } catch (err) {
      this.store.clearInFlight(this.serializedKey);
      if (this.destroyed || signal.aborted) return;
      const error = err instanceof Error ? err : new Error(String(err));
      this.setState({ ...this.state, status: 'error', error });
    }
  }

  private async executeWithRetry(attempt: number, signal: AbortSignal): Promise<T> {
    try {
      return await this.config.fn(signal);
    } catch (err) {
      if (attempt < this.cacheConfig.retry && !signal.aborted) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        if (signal.aborted) throw err;
        return this.executeWithRetry(attempt + 1, signal);
      }
      throw err;
    }
  }

  private setupSideEffects(): void {
    if (this.sideEffectsSetUp) return;
    this.sideEffectsSetUp = true;

    if (this.config.refetchInterval !== undefined) {
      this.intervalId = setInterval(() => {
        void this.refetch();
      }, this.config.refetchInterval);
    }

    if (this.cacheConfig.refetchOnWindowFocus) {
      this.visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          if (this.store.isStale(this.serializedKey, this.staleTime)) {
            void this.refetch();
          }
        }
      };
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.visibilityHandler);
      }
    }
  }

  private setState(next: QueryState<T>): void {
    this.state = next;
    for (const cb of this.subscribers) cb(next);
  }
}
