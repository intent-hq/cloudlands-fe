<script lang="ts">
  /** Test harness: a gated panel whose child holds unsaved local state. */
  import WorkspaceHomePanelGate from './WorkspaceHomePanelGate.svelte';

  let { workspaceId }: { workspaceId: string } = $props();
</script>

<WorkspaceHomePanelGate {workspaceId}>
  <textarea data-gated-child aria-label="draft">unsaved draft</textarea>
</WorkspaceHomePanelGate>
