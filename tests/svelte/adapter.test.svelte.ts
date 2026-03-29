import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import QueryTest from './fixtures/QueryTest.svelte';

describe('Svelte adapter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
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
    const fn = vi.fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');
    render(QueryTest, { props: { fn } });

    await vi.runAllTimersAsync();
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('"first"'));

    fireEvent.click(screen.getByText('refetch'));
    await vi.runAllTimersAsync();
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('"second"'));
  });
});
