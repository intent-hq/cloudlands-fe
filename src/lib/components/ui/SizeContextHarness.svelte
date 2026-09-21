<script lang="ts">
  import { SizeProvider } from './index.js';
  import SizeContextConsumer from './SizeContextConsumer.svelte';
</script>

<SizeContextConsumer testId="unscoped-size" />
<SizeProvider size="compact">
  <SizeContextConsumer testId="compact-size" />
  <SizeProvider size="default">
    <SizeContextConsumer testId="nested-size" />
  </SizeProvider>
</SizeProvider>
