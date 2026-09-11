<script lang="ts">
  import { onMount } from 'svelte';
  import { Virtualizer } from '@pierre/diffs';
  import DiffViewer from '../DiffViewer.svelte';

  let scrollContainer: HTMLDivElement;
  let virtualizer = $state<Virtualizer>();

  onMount(() => {
    const instance = new Virtualizer();
    instance.setup(scrollContainer);
    virtualizer = instance;
    return () => instance.cleanUp();
  });
</script>

<div bind:this={scrollContainer} style="height: 300px; overflow: auto">
  {#if virtualizer}
    <DiffViewer
      {virtualizer}
      fileName="greeting.ts"
      oldContent={'const greeting = "Hello";\n'}
      newContent={'const greeting = "Welcome";\n'}
      viewMode="split"
    />
  {/if}
</div>
