<script lang="ts">
  /** @internal Test host for image-attachment-feedback.ct.spec.ts. */
  import { Toast } from '$lib/components/ui/toast';
  import SimpleRichInputQueueTestHost from './SimpleRichInputQueueTestHost.svelte';
</script>

<SimpleRichInputQueueTestHost chief queueCount={0} width={560} />
<Toast />
