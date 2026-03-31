import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCache } from '../../src/index';
import CacheQueryTest from './fixtures/CacheQueryTest.svelte';
import QueryTest from './fixtures/QueryTest.svelte';
import ReactiveKeyTest from './fixtures/ReactiveKeyTest.svelte';
import SelectTest from './fixtures/SelectTest.svelte';

describe('Svelte adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows loading status on first fetch', async () => {
    const fn = vi.fn().mockResolvedValue([1, 2]);
    render(QueryTest, { props: { fn } });

    expect(screen.getByTestId('status').textContent).toBe('loading');
  });

  it('transitions from loading to success', async () => {
    const fn = vi.fn().mockResolvedValue([1, 2]);
    render(QueryTest, { props: { fn } });

    await vi.runAllTimersAsync();
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('success');
      expect(screen.getByTestId('data').textContent).toBe('[1,2]');
    });
  });

  it('shows error status on fetch failure after retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('network error'));
    render(QueryTest, { props: { fn } });

    await vi.runAllTimersAsync();
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error');
      expect(screen.getByTestId('error').textContent).toBe('network error');
    });
  });

  it('stays idle when enabled is false', async () => {
    const fn = vi.fn();
    render(QueryTest, { props: { fn, enabled: false } });

    await vi.runAllTimersAsync();
    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(fn).not.toHaveBeenCalled();
  });

  it('stays idle when enabled function throws', async () => {
    const fn = vi.fn();
    render(QueryTest, {
      props: {
        fn,
        enabled: () => {
          throw new Error('boom');
        },
      },
    });

    await vi.runAllTimersAsync();
    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not fetch when refetch() is called on a disabled query', async () => {
    const fn = vi.fn().mockResolvedValue('data');
    render(QueryTest, { props: { fn, enabled: false } });

    await vi.runAllTimersAsync();
    expect(fn).not.toHaveBeenCalled();

    // Click the refetch button — should be a no-op when disabled
    fireEvent.click(screen.getByText('refetch'));
    await vi.runAllTimersAsync();

    expect(fn).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('triggers refetch on button click', async () => {
    const fn = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    render(QueryTest, { props: { fn } });

    await vi.runAllTimersAsync();
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('"first"'));

    fireEvent.click(screen.getByText('refetch'));
    await vi.runAllTimersAsync();
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('"second"'));
  });

  describe('reactive keys', () => {
    it('re-fetches when key getter returns a new value', async () => {
      const fn = vi.fn(async (_signal: AbortSignal) => 'user-data');
      const { component } = render(ReactiveKeyTest, { props: { fn } });

      await vi.runAllTimersAsync();
      await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('"user-data"'));
      expect(fn).toHaveBeenCalledTimes(1);

      component.setUserId(2);
      await vi.runAllTimersAsync();
      await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    });
  });

  describe('keepPreviousData', () => {
    it('shows previous data with refreshing status during key change instead of loading', async () => {
      let resolveFetch: ((value: string) => void) | undefined;
      let callCount = 0;

      const fn = vi.fn(async (_signal: AbortSignal) => {
        callCount++;
        if (callCount === 1) return 'user-1';
        // Second call — return a promise we control
        return new Promise<string>((resolve) => {
          resolveFetch = resolve;
        });
      });

      const { component } = render(ReactiveKeyTest, {
        props: { fn, keepPreviousData: true },
      });

      // First fetch completes normally
      await vi.runAllTimersAsync();
      await waitFor(() => {
        expect(screen.getByTestId('status').textContent).toBe('success');
        expect(screen.getByTestId('data').textContent).toBe('"user-1"');
      });

      // Change key — effect will re-run but second fetch is pending
      component.setUserId(2);
      await tick(); // flush the $effect

      // NOW verify keepPreviousData: status should be 'refreshing', data still shows old value
      expect(screen.getByTestId('status').textContent).toBe('refreshing');
      expect(screen.getByTestId('data').textContent).toBe('"user-1"');

      // Resolve the pending fetch
      resolveFetch?.('user-2');
      await vi.runAllTimersAsync();
      await waitFor(() => {
        expect(screen.getByTestId('data').textContent).toBe('"user-2"');
      });
    });
  });

  describe('refetchOnReconnect', () => {
    it('refetches stale query when browser comes back online', async () => {
      const fn = vi.fn(async (_signal: AbortSignal) => 'data');
      render(QueryTest, { props: { fn, staleTime: 0 } });

      await vi.runAllTimersAsync();
      expect(fn).toHaveBeenCalledTimes(1);

      // Advance time so the entry is stale (staleTime: 0, needs timestamp < Date.now())
      vi.advanceTimersByTime(1);
      window.dispatchEvent(new Event('online'));
      await vi.runAllTimersAsync();

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not refetch when refetchOnReconnect is false', async () => {
      const fn = vi.fn(async (_signal: AbortSignal) => 'data');
      render(QueryTest, { props: { fn, staleTime: 0, refetchOnReconnect: false } });

      await vi.runAllTimersAsync();
      expect(fn).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event('online'));
      await vi.runAllTimersAsync();

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('select', () => {
    it('delivers transformed data to the component', async () => {
      const fn = vi.fn(async (_signal: AbortSignal) => [1, 2, 3]);
      render(SelectTest, { props: { fn, cacheKey: 'nums' } });

      await vi.runAllTimersAsync();
      await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('[2,4,6]'));
    });

    it('stores raw data in cache, not selected data', async () => {
      const fn = vi.fn(async (_signal: AbortSignal) => [1, 2, 3]);
      const { component } = render(SelectTest, { props: { fn, cacheKey: 'nums2' } });

      await vi.runAllTimersAsync();
      // The selected data ([2,4,6]) is shown in the DOM
      await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('[2,4,6]'));
      // But the raw data ([1,2,3]) is in the cache
      expect(component.cache.getQueryData<number[]>('nums2')).toEqual([1, 2, 3]);
    });
  });

  describe('prefetch', () => {
    it('pre-loads data into the cache without creating a reactive result', async () => {
      const fn = vi.fn(async (_signal: AbortSignal) => [1, 2, 3]);
      const cache = createCache({ refetchOnWindowFocus: false });

      await cache.prefetch({ key: 'prefetch-test', fn });

      expect(fn).toHaveBeenCalledTimes(1);
      expect(cache.getQueryData<number[]>('prefetch-test')).toEqual([1, 2, 3]);
    });

    it('does not re-fetch if data is still fresh', async () => {
      const fn = vi.fn(async (_signal: AbortSignal) => 'data');
      const cache = createCache({ refetchOnWindowFocus: false, staleTime: 60_000 });

      await cache.prefetch({ key: 'prefetch-fresh', fn });
      await cache.prefetch({ key: 'prefetch-fresh', fn });

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('silently discards fetch errors', async () => {
      const fn = vi.fn(async () => {
        throw new Error('network error');
      });
      const cache = createCache({ refetchOnWindowFocus: false });

      await expect(cache.prefetch({ key: 'prefetch-error', fn })).resolves.toBeUndefined();
      expect(cache.getQueryData('prefetch-error')).toBeUndefined();
    });

    it('deduplicates concurrent prefetches for the same key to a single fn call', async () => {
      let resolve!: (v: string) => void;
      const fn = vi.fn(
        () => new Promise<string>((r) => { resolve = r; }),
      );
      const cache = createCache({ refetchOnWindowFocus: false });

      const p1 = cache.prefetch({ key: 'prefetch-dedup', fn });
      const p2 = cache.prefetch({ key: 'prefetch-dedup', fn });

      resolve('shared');
      await vi.runAllTimersAsync();
      await Promise.all([p1, p2]);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(cache.getQueryData('prefetch-dedup')).toBe('shared');
    });
  });

  describe('onError integration', () => {
    it('fires onError at cache level when query fails after all retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('network error'));
      const onError = vi.fn();
      const cache = createCache({ refetchOnWindowFocus: false, retry: 0, onError });
      render(CacheQueryTest, { cache, fn, queryKey: 'onError-test' });
      await vi.runAllTimersAsync();
      expect(onError).toHaveBeenCalledWith(expect.any(Error), ['onError-test']);
    });
  });

  describe('rehydrate', () => {
    it('seeds cache so query starts at success with no loading flash', async () => {
      const fn = vi.fn().mockResolvedValue([1, 2, 3]);
      const serverCache = createCache({ refetchOnWindowFocus: false });
      await serverCache.prefetch({ key: 'ssr-todos', fn });
      const dehydrated = serverCache.dehydrate();

      const clientCache = createCache({ refetchOnWindowFocus: false });
      clientCache.rehydrate(dehydrated);

      const { getByTestId } = render(CacheQueryTest, { cache: clientCache, fn, queryKey: 'ssr-todos' });
      // After rehydrate the cache has data — query should start at success, not loading
      await tick();
      expect(getByTestId('status').textContent).toBe('success');
      expect(getByTestId('data').textContent).toBe('[1,2,3]');
      // fn was called once for prefetch — not again on the client query (cache hit)
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
