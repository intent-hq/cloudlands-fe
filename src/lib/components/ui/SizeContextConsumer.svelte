<script lang="ts">
  import { useSize } from './index.js';

  let { testId }: { testId: string } = $props();
  const size = useSize();
</script>

<output data-testid={testId}>{size}</output>
