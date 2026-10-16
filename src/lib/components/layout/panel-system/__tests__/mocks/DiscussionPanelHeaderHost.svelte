<script lang="ts">
  import type { Snippet } from 'svelte';
  import PanelTabBar from '../../PanelTabBar.svelte';
  import DiscussionHeader from '$features/discussions/components/DiscussionHeader.svelte';
  let {
    onTabClick,
    onMovePaneLeft,
    onTabClose,
  }: {
    onTabClick: (id: string) => void;
    onMovePaneLeft: () => void;
    onTabClose: (id: string) => void;
  } = $props();
</script>

{#snippet discussionHeader(paneItems: Snippet | undefined, paneActions: Snippet)}
  <DiscussionHeader
    title="Workspace"
    conversationId="default"
    rows={[{ id: 'default', title: 'Workspace' }]}
    onSelect={() => {}}
    onNew={() => {}}
    onRefresh={() => {}}
    onClose={() => {}}
    {paneItems}
    {paneActions}
  />
{/snippet}

<PanelTabBar
  tabs={[
    { id: 'discussion', type: 'discussion', title: 'Workspace', closable: true },
    { id: 'file', type: 'file', title: 'main.ts', filePath: 'src/main.ts', closable: true },
  ]}
  activeTabId="discussion"
  panelId="panel-1"
  workspaceId="workspace-1"
  contentActions={{ discussionHeader }}
  {onTabClick}
  {onMovePaneLeft}
  {onTabClose}
/>
