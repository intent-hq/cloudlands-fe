<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Toast } from '$lib/components/ui/toast';
  import BulkTransferModalHost from '$lib/components/modals/BulkTransferModalHost.svelte';
  import HomePage from './HomePage.svelte';
  import { setupHomeBulkTransferFixtures } from '../../test/fixtures/home-bulk-transfer';

  let { height = 800 }: { height?: number } = $props();
  const dispose = untrack(() => setupHomeBulkTransferFixtures());
  onDestroy(dispose);
</script>

<div class="min-h-0 bg-background text-foreground" style:height="{height}px">
  <HomePage />
  <BulkTransferModalHost />
  <Toast />
</div>
