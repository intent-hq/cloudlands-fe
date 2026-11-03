<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'no-backend-screen',
    title: 'Intent Web: no machine yet',
    defaultState: 'default',
    states: { default: { props: {} } },
  });
</script>

<script lang="ts">
  import NoBackendScreen from './NoBackendScreen.svelte';
</script>

<div class="h-[28rem] bg-sidebar">
  <NoBackendScreen />
</div>
