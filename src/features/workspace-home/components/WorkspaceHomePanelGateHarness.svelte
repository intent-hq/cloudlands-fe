<script lang="ts">
  /** Test harness: a gated panel whose child holds unsaved local state. */
  import WorkspaceHomePanelGate from './WorkspaceHomePanelGate.svelte';

  let { workspaceId, clock }: { workspaceId: string; clock?: () => number } = $props();
</script>

<WorkspaceHomePanelGate {workspaceId} {clock}>
  <textarea data-gated-child aria-label="draft">unsaved draft</textarea>
</WorkspaceHomePanelGate>
