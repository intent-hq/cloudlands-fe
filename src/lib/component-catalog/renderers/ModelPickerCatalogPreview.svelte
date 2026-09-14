<script lang="ts">
  import { onMount, type Component } from 'svelte';

  let Preview = $state<Component | undefined>();
  let props = $state({});
  onMount(() => {
    let disposed = false;
    let cleanup: void | (() => void);
    // Load the store-backed fixture after the catalog registry has initialized.
    void import('$lib/components/chat/input/model-picker.preview').then((module) => {
      if (disposed) return;
      const state = module.preview.states.populated;
      cleanup = state.setup?.();
      props = state.props;
      Preview = module.default;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  });
</script>

{#if Preview}
  <Preview {...props} />
{/if}
