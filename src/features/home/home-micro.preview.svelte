<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    scenario?: 'list' | 'board' | 'disconnected';
  }
  export const preview = definePreview<Props>({
    id: 'home-micro',
    title: 'Home Micro assignments',
    defaultState: 'list',
    states: {
      list: { props: { scenario: 'list' } },
      board: { props: { scenario: 'board' } },
      disconnected: { props: { scenario: 'disconnected' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import HomePreview from './home.preview.svelte';
  import { startHomePreview } from './home-preview-lifecycle';
  import { setupHomeMicroPreview } from './home-micro-preview-fixture';
  let { scenario = 'list' }: Props = $props();
  let previewRoot = $state<HTMLDivElement | null>(null);
  const stop = startHomePreview(() => []);
  const fixture = setupHomeMicroPreview(untrack(() => scenario !== 'disconnected'));
  $effect(() => fixture.setConnected(scenario !== 'disconnected'));
  onMount(() => {
    const root = previewRoot;
    if (!root) return;
    const loadImages = () => {
      // Home transitions can add avatars after the preview mounts.
      root.querySelectorAll('img').forEach((image) => (image.loading = 'eager'));
    };
    const observer = new MutationObserver(loadImages);
    observer.observe(root, { childList: true, subtree: true });
    loadImages();
    return () => observer.disconnect();
  });
  onDestroy(() => {
    fixture.dispose();
    stop();
  });
</script>

<div class="contents" bind:this={previewRoot}>
  <HomePreview scenario={scenario === 'list' ? 'populated' : 'board'} />
</div>
