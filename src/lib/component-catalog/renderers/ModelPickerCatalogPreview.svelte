<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let _catalogProps: CatalogRendererProps = $props();

  let Preview = $state<Component | undefined>();
  let previewProps = $state({});
  onMount(() => {
    let disposed = false;
    let cleanup: void | (() => void);
    // Load the store-backed fixture after the catalog registry has initialized.
    void import('$lib/components/chat/input/model-picker.preview').then((module) => {
      if (disposed) return;
      const state = module.preview.states.populated;
      cleanup = state.setup?.();
      previewProps = state.props;
      Preview = module.default;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  });
</script>

{#if Preview}
  <Preview {...previewProps} />
{/if}
