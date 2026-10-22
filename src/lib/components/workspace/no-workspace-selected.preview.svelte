<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'no-workspace-selected',
    title: 'No workspace selected',
    defaultState: 'default',
    states: { default: { props: {} } },
  });
</script>

<script lang="ts">
  import HomePreview from '$features/home/home.preview.svelte';
</script>

<div data-home-empty-preview><HomePreview scenario="empty" /></div>
