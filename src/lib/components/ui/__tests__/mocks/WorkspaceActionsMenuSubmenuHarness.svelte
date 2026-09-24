<script lang="ts">
  import WorkspaceActionsMenu from '$features/workspace/components/WorkspaceActionsMenu.svelte';
  import type { MenuAction } from '$features/workspace/components/WorkspaceActionsMenu.svelte';
  import * as Menu from '$lib/components/ui/menu';

  interface Props {
    filePath?: string;
    workspaceId?: string;
    workspaceFolderPath?: string;
    isWorkspaceRoot?: boolean;
    additionalActions?: MenuAction[];
  }

  let {
    filePath = '/tmp/project',
    workspaceId = '',
    workspaceFolderPath = '',
    isWorkspaceRoot = false,
    additionalActions = [],
  }: Props = $props();
  let open = $state(false);
</script>

<Menu.Root bind:open>
  <Menu.Trigger>Actions</Menu.Trigger>
  <Menu.Content portal={false}>
    <WorkspaceActionsMenu
      layout="submenu"
      {filePath}
      {workspaceId}
      {workspaceFolderPath}
      {isWorkspaceRoot}
      {additionalActions}
      showFileActions
      onClose={() => (open = false)}
    />
  </Menu.Content>
</Menu.Root>
