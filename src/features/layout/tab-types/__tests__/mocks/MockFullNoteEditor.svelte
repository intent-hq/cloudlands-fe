<script module lang="ts">
  export const fullEditControl = {
    finish: async (): Promise<void> => {},
    mounts: [] as Array<boolean | undefined>,
    instances: [] as Array<string | undefined>,
  };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  onMount(() => {
    fullEditControl.mounts.push(rawView);
    fullEditControl.instances.push(noteInstanceId);
  });
  let { rawView, noteInstanceId }: { rawView?: boolean; noteInstanceId?: string } = $props();
  export function finishEditing() {
    return fullEditControl.finish();
  }
</script>

<div data-testid="full-note-editor" data-raw={rawView === true}>Editable note</div>
