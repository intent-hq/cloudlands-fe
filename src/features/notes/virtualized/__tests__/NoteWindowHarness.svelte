<script lang="ts">
  import { onMount } from 'svelte';
  import { mountNoteWindowFixture } from './note-window-fixture';
  let root: HTMLDivElement;
  let scroller: HTMLDivElement;
  let status = $state('loading');
  onMount(() => mountNoteWindowFixture(root, scroller, (value) => (status = value)));
</script>

<div bind:this={root} data-testid="reading-harness" data-status={status}>
  <div
    bind:this={scroller}
    data-testid="reading-scroller"
    style="height:520px;width:660px;overflow:auto;position:relative"
  ></div>
</div>
