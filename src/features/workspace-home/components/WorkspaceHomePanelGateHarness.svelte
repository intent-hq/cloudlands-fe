<script lang="ts">
  /** Test harness: a gated panel whose child holds unsaved local state. */
  import WorkspaceHomePanelGate from './WorkspaceHomePanelGate.svelte';
  import EditableChildHarness from './EditableChildHarness.svelte';

  let {
    workspaceId,
    clock,
    reportsContent = false,
  }: { workspaceId: string; clock?: () => number; reportsContent?: boolean } = $props();
</script>

<WorkspaceHomePanelGate {workspaceId} {clock}>
  <EditableChildHarness {reportsContent} />
</WorkspaceHomePanelGate>
