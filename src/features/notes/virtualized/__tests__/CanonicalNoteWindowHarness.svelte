<script lang="ts">
  import { onMount } from 'svelte';
  import { mountCanonicalTableFixture } from './canonical-window-fixture';
  let { storeRole }: { storeRole?: 'td' | 'th' } = $props();
  let root: HTMLDivElement, scroller: HTMLDivElement;
  let status = $state('loading');
  onMount(() => mountCanonicalTableFixture(root, scroller, (value) => (status = value), storeRole));
</script>

<div bind:this={root} data-testid="canonical-reading-harness" data-status={status}>
  <div
    bind:this={scroller}
    data-testid="canonical-reading-scroller"
    style="height:520px;width:660px;overflow:auto;position:relative"
  ></div>
</div>
