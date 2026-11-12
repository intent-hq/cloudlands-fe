<script lang="ts">
  /** @internal Test probe rendered by SizeContextHarness. */
  import { useSize } from './index.js';

  let { testId }: { testId: string } = $props();
  const size = useSize();
</script>

<output data-testid={testId}>{size}</output>
