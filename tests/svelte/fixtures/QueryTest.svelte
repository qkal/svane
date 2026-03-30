<script lang="ts">
import { createCache } from '../../../src/index';

interface Props {
  fn: (signal: AbortSignal) => Promise<unknown>;
  enabled?: boolean | (() => boolean);
  staleTime?: number;
  refetchOnReconnect?: boolean;
}

const { fn, enabled, staleTime, refetchOnReconnect = true }: Props = $props();

const cache = createCache({
  refetchOnWindowFocus: false,
  ...(staleTime !== undefined && { staleTime }),
  ...(refetchOnReconnect !== undefined && { refetchOnReconnect }),
});
const result = cache.query({ key: 'test', fn, enabled });
</script>

<div data-testid="status">{result.status}</div>
<div data-testid="data">{JSON.stringify(result.data ?? null)}</div>
<div data-testid="error">{result.error?.message ?? ''}</div>
<div data-testid="isStale">{String(result.isStale)}</div>
<button onclick={() => result.refetch()}>refetch</button>
