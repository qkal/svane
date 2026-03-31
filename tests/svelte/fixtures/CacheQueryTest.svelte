<script lang="ts">
import type { createCache } from '../../../src/index';

interface Props {
  cache: ReturnType<typeof createCache>;
  fn: (signal: AbortSignal) => Promise<unknown>;
  queryKey?: string;
}

const { cache, fn, queryKey = 'cache-query-test' }: Props = $props();
const result = cache.query({ key: queryKey, fn });
</script>

<div data-testid="status">{result.status}</div>
<div data-testid="data">{JSON.stringify(result.data ?? null)}</div>
