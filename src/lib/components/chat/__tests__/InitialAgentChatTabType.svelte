<script lang="ts">
  import type { TabTypeComponentProps } from '$features/layout/tab-types/registry';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import ChatPanel from '../ChatPanel.svelte';

  let { tab, workspaceId, isActive, isPanelFocused }: TabTypeComponentProps = $props();
  // svelte-ignore state_referenced_locally -- each CT mount uses one immutable workspace.
  const workspace$ = selectWorkspaceById(workspaceId);
</script>

{#if $workspace$ && tab.agentId}
  <ChatPanel
    workspace={$workspace$}
    agentId={tab.agentId}
    agentName={tab.title}
    {isActive}
    {isPanelFocused}
    isInitialWorkspaceAgent
    initialPrompt="Align the chat panel"
  />
{/if}
