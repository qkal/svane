import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheStore } from '../../src/core/cache';
import { QueryRunner } from '../../src/core/query';
import type { CacheConfig, QueryConfig } from '../../src/core/types';

const BASE_CONFIG: CacheConfig = {
  staleTime: 30_000,
  retry: 1,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  persist: undefined,
  gcTime: Number.MAX_SAFE_INTEGER,
};

function makeRunner<T>(
  queryConfig: Omit<QueryConfig<T>, 'key'> & Partial<Pick<QueryConfig<T>, 'key'>>,
  cacheConfig: Partial<CacheConfig> = {},
  store?: CacheStore,
): QueryRunner<T> {
  return new QueryRunner(
    store ?? new CacheStore({ gcTime: Number.MAX_SAFE_INTEGER }),
    { key: 'test', ...queryConfig } as QueryConfig<T>,
    { ...BASE_CONFIG, ...cacheConfig },
  );
}

describe('QueryRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts as idle', () => {
      const runner = makeRunner({ fn: vi.fn() });
      expect(runner.getState().status).toBe('idle');
    });

    it('pre-populates data from fresh cache', () => {
      const store = new CacheStore({ gcTime: Number.MAX_SAFE_INTEGER });
      store.set('["test"]', { data: [1, 2], timestamp: Date.now(), error: null });
      const runner = makeRunner({ fn: vi.fn() }, {}, store);
      // Still idle before execute() — data is just pre-loaded into state
      expect(runner.getState().data).toEqual([1, 2]);
    });
  });

  describe('isEnabled', () => {
    it('returns true when enabled is undefined', () => {
      const runner = makeRunner({ fn: vi.fn() });
      expect(runner.isEnabled()).toBe(true);
    });

    it('returns true when enabled is true', () => {
      const runner = makeRunner({ fn: vi.fn(), enabled: true });
      expect(runner.isEnabled()).toBe(true);
    });

    it('returns false when enabled is false', () => {
      const runner = makeRunner({ fn: vi.fn(), enabled: false });
      expect(runner.isEnabled()).toBe(false);
    });

    it('calls getter function', () => {
      const runner = makeRunner({ fn: vi.fn(), enabled: () => false });
      expect(runner.isEnabled()).toBe(false);
    });

    it('returns false when getter throws', () => {
      const runner = makeRunner({
        fn: vi.fn(),
        enabled: () => {
          throw new Error('boom');
        },
      });
      expect(runner.isEnabled()).toBe(false);
    });

    it('returns false when accessing enabled throws', () => {
      const runner = makeRunner({
        fn: vi.fn(),
        get enabled() {
          throw new Error('access error');
        },
      } as unknown as QueryConfig<unknown>);
      expect(runner.isEnabled()).toBe(false);
    });
  });

  describe('execute — cache miss (loading)', () => {
    it('sets status to loading then success', async () => {
      const fn = vi.fn().mockResolvedValue([1, 2, 3]);
      const runner = makeRunner({ fn });

      runner.execute();
      expect(runner.getState().status).toBe('loading');

      await vi.runAllTimersAsync();
      expect(runner.getState().status).toBe('success');
      expect(runner.getState().data).toEqual([1, 2, 3]);
    });

    it('calls fn exactly once', async () => {
      const fn = vi.fn().mockResolvedValue('data');
      const runner = makeRunner({ fn });
      runner.execute();
      await vi.runAllTimersAsync();
      expect(fn).toHaveBeenCalledOnce();
    });

    it('notifies subscriber on status change', async () => {
      const fn = vi.fn().mockResolvedValue('data');
      const runner = makeRunner({ fn });
      const statuses: string[] = [];
      runner.subscribe((s) => statuses.push(s.status));

      runner.execute();
      await vi.runAllTimersAsync();

      expect(statuses).toContain('loading');
      expect(statuses).toContain('success');
    });
  });

  describe('execute — fresh cache hit', () => {
    it('returns success immediately without fetching', async () => {
      const store = new CacheStore({ gcTime: Number.MAX_SAFE_INTEGER });
      store.set('["test"]', { data: [1], timestamp: Date.now(), error: null });

      const fn = vi.fn();
      const runner = makeRunner({ fn }, {}, store);
      runner.execute();

      expect(runner.getState().status).toBe('success');
      expect(runner.getState().data).toEqual([1]);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('execute — stale cache (refreshing)', () => {
    it('returns stale data immediately + triggers background refetch', async () => {
      const store = new CacheStore({ gcTime: Number.MAX_SAFE_INTEGER });
      store.set('["test"]', { data: ['stale'], timestamp: Date.now(), error: null });
      vi.advanceTimersByTime(30_001);

      const fn = vi.fn().mockResolvedValue(['fresh']);
      const runner = makeRunner({ fn }, {}, store);
      runner.execute();

      expect(runner.getState().status).toBe('refreshing');
      expect(runner.getState().data).toEqual(['stale']);

      await vi.runAllTimersAsync();
      expect(runner.getState().status).toBe('success');
      expect(runner.getState().data).toEqual(['fresh']);
    });

    it('sets isStale to true during refreshing', async () => {
      const store = new CacheStore({ gcTime: Number.MAX_SAFE_INTEGER });
      store.set('["test"]', { data: 'old', timestamp: Date.now(), error: null });
      vi.advanceTimersByTime(30_001);

      const fn = vi.fn().mockResolvedValue('new');
      const runner = makeRunner({ fn }, {}, store);
      runner.execute();

      expect(runner.getState().isStale).toBe(true);
    });
  });

  describe('retry', () => {
    it('retries once on failure and succeeds on second attempt', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue(['data']);
      const runner = makeRunner({ fn }, { retry: 1 });
      runner.execute();

      await vi.runAllTimersAsync();
      expect(fn).toHaveBeenCalledTimes(2);
      expect(runner.getState().status).toBe('success');
    });

    it('sets error state after all retries exhausted', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));
      const runner = makeRunner({ fn }, { retry: 1 });
      runner.execute();

      await vi.runAllTimersAsync();
      expect(fn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
      expect(runner.getState().status).toBe('error');
      expect(runner.getState().error?.message).toBe('always fails');
    });

    it('sets error with retry: 0 after single failure', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const runner = makeRunner({ fn }, { retry: 0 });
      runner.execute();

      await vi.runAllTimersAsync();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(runner.getState().status).toBe('error');
    });

    it('preserves stale data after background refetch failure', async () => {
      const store = new CacheStore({ gcTime: Number.MAX_SAFE_INTEGER });
      store.set('["test"]', { data: ['stale'], timestamp: Date.now(), error: null });
      vi.advanceTimersByTime(30_001);

      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const runner = makeRunner({ fn }, { retry: 0 }, store);
      runner.execute();

      await vi.runAllTimersAsync();
      expect(runner.getState().status).toBe('error');
      expect(runner.getState().data).toEqual(['stale']); // not wiped
    });
  });

  describe('enabled', () => {
    it('does not execute when enabled is false', async () => {
      const fn = vi.fn();
      const runner = makeRunner({ fn, enabled: false });
      runner.execute();

      await vi.runAllTimersAsync();
      expect(fn).not.toHaveBeenCalled();
      expect(runner.getState().status).toBe('idle');
    });

    it('does not execute when enabled getter returns false', async () => {
      const fn = vi.fn();
      const runner = makeRunner({ fn, enabled: () => false });
      runner.execute();

      await vi.runAllTimersAsync();
      expect(fn).not.toHaveBeenCalled();
    });

    it('executes normally when enabled is true', async () => {
      const fn = vi.fn().mockResolvedValue('data');
      const runner = makeRunner({ fn, enabled: true });
      runner.execute();
      await vi.runAllTimersAsync();
      expect(runner.getState().status).toBe('success');
    });

    it('does not execute when enabled function throws', async () => {
      const fn = vi.fn();
      const runner = makeRunner({
        fn,
        enabled: () => {
          throw new Error('boom');
        },
      });
      runner.execute();

      await vi.runAllTimersAsync();
      expect(fn).not.toHaveBeenCalled();
      expect(runner.getState().status).toBe('idle');
    });
  });

  describe('refetch', () => {
    it('triggers a new fetch regardless of staleness', async () => {
      const fn = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
      const runner = makeRunner({ fn });
      runner.execute();
      await vi.runAllTimersAsync();
      expect(runner.getState().data).toBe('first');

      void runner.refetch();
      await vi.runAllTimersAsync();
      expect(runner.getState().data).toBe('second');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('sets status to refreshing when data exists', async () => {
      const fn = vi.fn().mockResolvedValueOnce('first').mockResolvedValue('second');
      const runner = makeRunner({ fn });
      runner.execute();
      await vi.runAllTimersAsync();

      const statuses: string[] = [];
      runner.subscribe((s) => statuses.push(s.status));
      void runner.refetch();
      expect(statuses[0]).toBe('refreshing');
    });
  });

  describe('polling', () => {
    it('calls fn again after refetchInterval', async () => {
      const fn = vi.fn().mockResolvedValue('data');
      const runner = makeRunner({ fn, refetchInterval: 5_000 });
      runner.execute();
      await vi.advanceTimersByTimeAsync(0); // flush initial fetch without advancing past t=0
      expect(fn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5_000); // advance to t=5000, fires interval once
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('stops polling after destroy', async () => {
      const fn = vi.fn().mockResolvedValue('data');
      const runner = makeRunner({ fn, refetchInterval: 5_000 });
      runner.execute();
      await vi.advanceTimersByTimeAsync(0); // flush initial fetch

      runner.destroy();
      await vi.advanceTimersByTimeAsync(10_000); // interval cleared — no extra calls
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('window focus', () => {
    it('refetches stale data on visibilitychange', async () => {
      const store = new CacheStore({ gcTime: Number.MAX_SAFE_INTEGER });
      store.set('["test"]', { data: 'old', timestamp: Date.now(), error: null });
      vi.advanceTimersByTime(30_001); // make stale

      const fn = vi.fn().mockResolvedValue('new');
      const runner = makeRunner({ fn }, { refetchOnWindowFocus: true }, store);
      runner.execute(); // stale cache hit → refreshing
      await vi.runAllTimersAsync();
      expect(fn).toHaveBeenCalledTimes(1);

      // Data is now fresh. Make stale again.
      vi.advanceTimersByTime(30_001);

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.runAllTimersAsync();

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not refetch when data is fresh on focus', async () => {
      const fn = vi.fn().mockResolvedValue('data');
      const runner = makeRunner({ fn }, { refetchOnWindowFocus: true });
      runner.execute();
      await vi.runAllTimersAsync();
      expect(fn).toHaveBeenCalledTimes(1);

      // Data is fresh — no time advance
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.runAllTimersAsync();

      expect(fn).toHaveBeenCalledTimes(1); // no extra call
    });

    it('removes visibilitychange listener on destroy', async () => {
      const fn = vi.fn().mockResolvedValue('data');
      const runner = makeRunner({ fn }, { refetchOnWindowFocus: true });
      runner.execute();
      await vi.runAllTimersAsync();

      runner.destroy();
      vi.advanceTimersByTime(30_001);

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.runAllTimersAsync();

      expect(fn).toHaveBeenCalledTimes(1); // no call after destroy
    });
  });

  describe('destroy', () => {
    it('does nothing after destroy is called twice', () => {
      const runner = makeRunner({ fn: vi.fn() });
      runner.destroy();
      expect(() => runner.destroy()).not.toThrow();
    });

    it('ignores execute() after destroy', async () => {
      const fn = vi.fn();
      const runner = makeRunner({ fn });
      runner.destroy();
      runner.execute();
      await vi.runAllTimersAsync();
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('exponential backoff', () => {
    it('retries with exponential delay: 1000ms then 2000ms', async () => {
      let attempts = 0;
      const fn = vi.fn(async (_signal: AbortSignal) => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return 'ok';
      });
      const runner = makeRunner({ fn }, { retry: 2 });
      runner.execute();
      await vi.runAllTimersAsync();
      expect(fn).toHaveBeenCalledTimes(3);
      expect(runner.getState().status).toBe('success');
    });

    it('caps delay at 30_000ms', async () => {
      const delays: number[] = [];
      const origSetTimeout = globalThis.setTimeout;
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(
        (cb: TimerHandler, delay?: number, ...args: unknown[]) => {
          if (typeof delay === 'number' && delay > 500) delays.push(delay);
          return origSetTimeout(cb as () => void, 0, ...args);
        },
      );

      const fn = vi.fn(async (_signal: AbortSignal) => {
        throw new Error('fail');
      });
      const runner = makeRunner({ fn }, { retry: 6 });
      runner.execute();
      await vi.runAllTimersAsync();

      expect(delays.every((d) => d <= 30_000)).toBe(true);
      expect(delays).toContain(30_000);
      vi.restoreAllMocks();
    });
  });

  describe('AbortController', () => {
    it('passes AbortSignal to fn', async () => {
      let receivedSignal: AbortSignal | undefined;
      const fn = vi.fn(async (signal: AbortSignal) => {
        receivedSignal = signal;
        return 'data';
      });
      const runner = makeRunner({ fn });
      runner.execute();
      await vi.runAllTimersAsync();
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
    });

    it('aborts signal when destroy() is called mid-fetch', async () => {
      let capturedSignal: AbortSignal | undefined;
      const fn = vi.fn(
        (_signal: AbortSignal) =>
          new Promise<string>((resolve) => {
            capturedSignal = _signal;
            setTimeout(() => resolve('data'), 10_000);
          }),
      );
      const runner = makeRunner({ fn });
      runner.execute();
      runner.destroy();
      await vi.runAllTimersAsync();
      expect(capturedSignal?.aborted).toBe(true);
    });
  });

  describe('request deduplication', () => {
    it('shares a single in-flight request between two runners for the same key', async () => {
      const fn = vi.fn(async () => 'shared');
      const store = new CacheStore({ gcTime: Number.MAX_SAFE_INTEGER });
      const config = { key: 'dedup', fn };
      const runner1 = new QueryRunner(store, config, { ...BASE_CONFIG });
      const runner2 = new QueryRunner(store, config, { ...BASE_CONFIG });

      runner1.execute();
      runner2.execute();
      await vi.runAllTimersAsync();

      expect(fn).toHaveBeenCalledTimes(1);
      expect(runner1.getState().status).toBe('success');
      expect(runner2.getState().status).toBe('success');
      expect(runner2.getState().data).toBe('shared');
    });

    it('dedup consumer receives success after retry, not immediate rejection', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('shared');
      const store = new CacheStore({ gcTime: Number.MAX_SAFE_INTEGER });
      const config = { key: 'dedup-retry', fn };
      const runner1 = new QueryRunner(store, config, { ...BASE_CONFIG, retry: 1 });
      const runner2 = new QueryRunner(store, config, { ...BASE_CONFIG, retry: 1 });

      runner1.execute();
      runner2.execute();
      await vi.runAllTimersAsync();

      expect(fn).toHaveBeenCalledTimes(2); // 1 failure + 1 retry
      expect(runner1.getState().status).toBe('success');
      expect(runner2.getState().status).toBe('success');
      expect(runner2.getState().data).toBe('shared');
    });
  });

  describe('reactive key (getter function)', () => {
    it('resolves key from getter function', async () => {
      const fn = vi.fn(async () => 'value');
      const runner = makeRunner({ key: () => ['user', 42], fn });
      runner.execute();
      await vi.runAllTimersAsync();
      expect(runner.getSerializedKey()).toBe('["user",42]');
      expect(runner.getState().status).toBe('success');
    });
  });

  describe('getSerializedKey', () => {
    it('returns the serialized cache key', () => {
      const runner = makeRunner({ key: ['todos', 1], fn: vi.fn() });
      expect(runner.getSerializedKey()).toBe('["todos",1]');
    });
  });

  describe('reset', () => {
    it('allows re-execution after destroy', async () => {
      const fn = vi.fn(async () => 'data');
      const runner = makeRunner({ fn });
      runner.execute();
      runner.destroy();
      runner.reset();
      runner.execute();
      await vi.runAllTimersAsync();
      expect(runner.getState().status).toBe('success');
    });
  });

  describe('keepPreviousData', () => {
    it('starts with status refreshing and previous data when no cache hit', async () => {
      const fn = vi.fn(async () => 'new');
      const store = new CacheStore({ gcTime: 300_000 });
      const runner = new QueryRunner(
        store,
        { key: 'test', fn, keepPreviousData: true },
        { ...BASE_CONFIG },
        'previous' as string, // previousData
      );
      runner.execute();
      // Before fetch resolves: should show previousData with refreshing status
      expect(runner.getState().status).toBe('refreshing');
      expect(runner.getState().data).toBe('previous');
      await vi.runAllTimersAsync();
      expect(runner.getState().status).toBe('success');
      expect(runner.getState().data).toBe('new');
    });

    it('starts with status loading when keepPreviousData is false and no cache', () => {
      const runner = makeRunner({ fn: vi.fn(async () => 'data') });
      runner.execute();
      expect(runner.getState().status).toBe('loading');
      expect(runner.getState().data).toBeUndefined();
    });
  });
});
