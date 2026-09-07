<script lang="ts">
  import { preview } from './diff-map.preview';
  import DiffMapPreview from './DiffMapPreview.svelte';

  let { stateName }: { stateName: string } = $props();
  const state = $derived(preview.states[stateName]);
</script>

<DiffMapPreview {...state.props} />
