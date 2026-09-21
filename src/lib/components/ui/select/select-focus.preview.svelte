<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    portal?: boolean;
    staticPosition?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'select-focus',
    title: 'Select Escape focus restoration',
    defaultState: 'portalled',
    states: {
      inline: { props: { portal: false } },
      portalled: { props: { portal: true } },
      static: { props: { staticPosition: true } },
    },
  });
</script>

<script lang="ts">
  import Harness from './select.test-harness.svelte';
  let { portal = false, staticPosition = false }: Props = $props();
</script>

<div class="w-full p-4" data-testid="select-focus-preview">
  <Harness {portal} {staticPosition} searchable />
</div>
