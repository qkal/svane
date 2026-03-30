import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      await waitFor(() =>
        expect(screen.getByTestId('data').textContent).toBe('"user-data"'),
      );
      expect(fn).toHaveBeenCalledTimes(1);

      component.setUserId(2);
      await vi.runAllTimersAsync();
      await waitFor(() =>
        expect(fn).toHaveBeenCalledTimes(2),
      );
    });
  });

  describe('keepPreviousData', () => {
    it('shows previous data with refreshing status during key change instead of loading', async () => {
      let resolveFetch: (value: string) => void;
      let callCount = 0;

      const fn = vi.fn(async (_signal: AbortSignal) => {
        callCount++;
        if (callCount === 1) return `user-1`;
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
      resolveFetch!('user-2');
      await vi.runAllTimersAsync();
      await waitFor(() => {
        expect(screen.getByTestId('data').textContent).toBe('"user-2"');
      });
    });
  });

  describe('select', () => {
    it('delivers transformed data to the component', async () => {
      const fn = vi.fn(async (_signal: AbortSignal) => [1, 2, 3]);
      render(SelectTest, { props: { fn, cacheKey: 'nums' } });

      await vi.runAllTimersAsync();
      await waitFor(() =>
        expect(screen.getByTestId('data').textContent).toBe('[2,4,6]'),
      );
    });

    it('stores raw data in cache, not selected data', async () => {
      const fn = vi.fn(async (_signal: AbortSignal) => [1, 2, 3]);
      const { component } = render(SelectTest, { props: { fn, cacheKey: 'nums2' } });

      await vi.runAllTimersAsync();
      // The selected data ([2,4,6]) is shown in the DOM
      await waitFor(() =>
        expect(screen.getByTestId('data').textContent).toBe('[2,4,6]'),
      );
      // But the raw data ([1,2,3]) is in the cache
      expect(component.cache.getQueryData<number[]>('nums2')).toEqual([1, 2, 3]);
    });
  });
});
