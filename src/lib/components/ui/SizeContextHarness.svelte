<script lang="ts">
  import { SizeProvider } from './index.js';
  import SizeContextConsumerTestHost from './SizeContextConsumerTestHost.svelte';
</script>

<SizeContextConsumerTestHost testId="unscoped-size" />
<SizeProvider size="compact">
  <SizeContextConsumerTestHost testId="compact-size" />
  <SizeProvider size="default">
    <SizeContextConsumerTestHost testId="nested-size" />
  </SizeProvider>
</SizeProvider>
