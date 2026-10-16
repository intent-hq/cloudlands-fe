<script lang="ts">
  import PanelTabBar from '../../PanelTabBar.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { m } from '$shared/paraglide/messages.js';
  let {
    onTabClick,
    onMovePaneLeft,
    onTabClose,
    onNew = () => {},
    onRefresh = () => {},
  }: {
    onTabClick: (id: string) => void;
    onMovePaneLeft: () => void;
    onTabClose: (id: string) => void;
    onNew?: () => void;
    onRefresh?: () => void;
  } = $props();
</script>

{#snippet discussionActions()}
  <Menu.Item onclick={onNew}>{m.workspace_discussion_new_title()}</Menu.Item>
  <Menu.Item onclick={onRefresh}>{m.workspace_commitsTimeline_refresh_label()}</Menu.Item>
{/snippet}

<PanelTabBar
  tabs={[
    { id: 'discussion', type: 'discussion', title: 'Workspace', closable: true },
    { id: 'file', type: 'file', title: 'main.ts', filePath: 'src/main.ts', closable: true },
  ]}
  activeTabId="discussion"
  panelId="panel-1"
  workspaceId="workspace-1"
  contentActions={{ actions: discussionActions }}
  {onTabClick}
  {onMovePaneLeft}
  {onTabClose}
/>
