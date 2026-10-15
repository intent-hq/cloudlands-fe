<script lang="ts">
  import WorkspaceDiscussion from '$features/discussions/components/WorkspaceDiscussion.svelte';
  import type { TabTypeComponentProps } from './registry';
  let { tab, workspaceId, isActive, isPanelFocused }: TabTypeComponentProps = $props();
</script>

{#key tab.workspaceId ?? workspaceId}
  <WorkspaceDiscussion workspaceId={tab.workspaceId ?? workspaceId} {isActive} {isPanelFocused} />
{/key}
