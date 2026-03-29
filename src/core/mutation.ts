import type { MutationConfig, MutationState } from './types';

type MutationSubscriber<TData> = (state: MutationState<TData>) => void;

/**
 * Orchestrates the mutation lifecycle: execute `fn`, call `onMutate`/`onSuccess`/`onError`/`onSettled`,
 * and notify reactive subscribers.
 *
 * @example
 * const runner = new MutationRunner({
 *   fn: (id: number, signal) => fetch(`/api/todos/${id}`, { method: 'DELETE', signal }),
 *   onMutate: (id) => cache.getQueryData<Todo[]>('todos'),
 *   onError: (_err, _id, prev) => cache.setQueryData('todos', prev),
 *   onSettled: () => cache.invalidate('todos'),
 * });
 * await runner.mutate(42);
 */
export class MutationRunner<TData, TVariables, TContext = unknown> {
  private state: MutationState<TData>;
  private readonly subscribers: Set<MutationSubscriber<TData>> = new Set();
  private abortController: AbortController | undefined;

  constructor(private readonly config: MutationConfig<TData, TVariables, TContext>) {
    this.state = { status: 'idle', data: undefined, error: null };
  }

  /** Returns a copy of the current mutation state. */
  getState(): MutationState<TData> {
    return { ...this.state };
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(callback: MutationSubscriber<TData>): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Executes the mutation with `variables`. Calls `onMutate`, then `fn`,
   * then `onSuccess`/`onError`, then `onSettled`.
   * If reset() is called mid-flight, the in-flight request is aborted and
   * the result is silently discarded.
   */
  async mutate(variables: TVariables): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    this.setState({ status: 'loading', data: undefined, error: null });

    let context: TContext | undefined;

    try {
      if (this.config.onMutate) {
        context = await this.config.onMutate(variables);
      }

      if (signal.aborted) return;

      const data = await this.config.fn(variables, signal);

      if (signal.aborted) return;

      this.setState({ status: 'success', data, error: null });
      await this.config.onSuccess?.(data, variables, context as TContext);
      await this.config.onSettled?.(data, null, variables, context as TContext);
    } catch (err) {
      if (signal.aborted) return;
      const error = err instanceof Error ? err : new Error(String(err));
      this.setState({ status: 'error', data: undefined, error });
      await this.config.onError?.(error, variables, context as TContext);
      await this.config.onSettled?.(undefined, error, variables, context as TContext);
    }
  }

  /**
   * Aborts any in-flight mutation and resets state to `idle`.
   */
  reset(): void {
    this.abortController?.abort();
    this.abortController = undefined;
    this.setState({ status: 'idle', data: undefined, error: null });
  }

  private setState(next: MutationState<TData>): void {
    this.state = next;
    for (const cb of this.subscribers) cb(next);
  }
}
