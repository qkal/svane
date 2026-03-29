import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MutationRunner } from '../../src/core/mutation';

describe('MutationRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts idle with no data or error', () => {
      const runner = new MutationRunner({ fn: vi.fn(async () => 'ok') });
      const state = runner.getState();
      expect(state.status).toBe('idle');
      expect(state.data).toBeUndefined();
      expect(state.error).toBeNull();
    });
  });

  describe('mutate — success lifecycle', () => {
    it('transitions idle → loading → success', async () => {
      const states: string[] = [];
      const fn = vi.fn(async () => 'result');
      const runner = new MutationRunner({ fn });
      runner.subscribe((s) => states.push(s.status));

      await runner.mutate('vars');

      expect(states).toEqual(['loading', 'success']);
      expect(runner.getState().data).toBe('result');
      expect(runner.getState().error).toBeNull();
    });

    it('calls onSuccess with data, variables, and context', async () => {
      const onSuccess = vi.fn();
      const onMutate = vi.fn(async (_vars: string) => ({ rollback: 'ctx' }));
      const fn = vi.fn(async (_vars: string) => 'result');
      const runner = new MutationRunner({ fn, onMutate, onSuccess });
      await runner.mutate('vars');
      expect(onSuccess).toHaveBeenCalledWith('result', 'vars', { rollback: 'ctx' });
    });

    it('calls onSettled with data, null error, variables, and context on success', async () => {
      const onSettled = vi.fn();
      const fn = vi.fn(async (_vars: string) => 'result');
      const runner = new MutationRunner({ fn, onSettled });
      await runner.mutate('vars');
      expect(onSettled).toHaveBeenCalledWith('result', null, 'vars', undefined);
    });
  });

  describe('mutate — error lifecycle', () => {
    it('transitions idle → loading → error', async () => {
      const states: string[] = [];
      const fn = vi.fn(async () => { throw new Error('boom'); });
      const runner = new MutationRunner({ fn });
      runner.subscribe((s) => states.push(s.status));
      await runner.mutate('vars');
      expect(states).toEqual(['loading', 'error']);
      expect(runner.getState().error?.message).toBe('boom');
    });

    it('calls onError with error, variables, and context', async () => {
      const onError = vi.fn();
      const onMutate = vi.fn(async () => 'ctx');
      const fn = vi.fn(async () => { throw new Error('oops'); });
      const runner = new MutationRunner({ fn, onMutate, onError });
      await runner.mutate('vars');
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'vars', 'ctx');
    });

    it('calls onSettled with undefined data, error, variables, context on error', async () => {
      const onSettled = vi.fn();
      const fn = vi.fn(async () => { throw new Error('fail'); });
      const runner = new MutationRunner({ fn, onSettled });
      await runner.mutate('vars');
      expect(onSettled).toHaveBeenCalledWith(undefined, expect.any(Error), 'vars', undefined);
    });

    it('transitions to error immediately if onMutate throws', async () => {
      const fn = vi.fn(async () => 'ok');
      const onMutate = vi.fn(async () => { throw new Error('mutate-fail'); });
      const runner = new MutationRunner({ fn, onMutate });
      await runner.mutate('vars');
      expect(runner.getState().status).toBe('error');
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('returns to idle and clears data and error after success', async () => {
      const fn = vi.fn(async () => 'result');
      const runner = new MutationRunner({ fn });
      await runner.mutate('vars');
      expect(runner.getState().status).toBe('success');
      runner.reset();
      expect(runner.getState().status).toBe('idle');
      expect(runner.getState().data).toBeUndefined();
      expect(runner.getState().error).toBeNull();
    });

    it('aborts in-flight request when reset is called mid-mutation', async () => {
      let signal: AbortSignal | undefined;
      const fn = vi.fn(
        (_vars: string, s: AbortSignal) =>
          new Promise<string>((resolve) => {
            signal = s;
            setTimeout(() => resolve('data'), 10_000);
          }),
      );
      const runner = new MutationRunner({ fn });
      const mutatePromise = runner.mutate('vars');
      runner.reset();
      await vi.runAllTimersAsync();
      await mutatePromise;
      expect(signal?.aborted).toBe(true);
      expect(runner.getState().status).toBe('idle');
    });
  });

  describe('subscribe', () => {
    it('returns an unsubscribe function', async () => {
      const fn = vi.fn(async () => 'ok');
      const runner = new MutationRunner({ fn });
      const cb = vi.fn();
      const unsub = runner.subscribe(cb);
      unsub();
      await runner.mutate('vars');
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
