<script lang="ts">
  import type { Snippet } from 'svelte';
  import { highlightTarget } from './highlight-target';

  interface Props {
    id: string;
    class?: string;
    children?: Snippet;
  }

  let { id, class: className = '', children }: Props = $props();
</script>

<div class={className} data-highlight-id={id} use:highlightTarget={{ id }}>
  {@render children?.()}
</div>
