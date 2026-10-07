<script module lang="ts">
  export const fullEditControl = {
    finish: async (): Promise<void> => {},
    mounts: [] as Array<boolean | undefined>,
  };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  onMount(() => {
    fullEditControl.mounts.push(rawView);
  });
  let { rawView }: { rawView?: boolean } = $props();
  export function finishEditing() {
    return fullEditControl.finish();
  }
</script>

<div data-testid="full-note-editor" data-raw={rawView === true}>Editable note</div>
