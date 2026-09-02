<script lang="ts">
  import WorkspaceActionsMenu from '$features/workspace/components/WorkspaceActionsMenu.svelte';
  import * as Menu from '$lib/components/ui/menu';

  let open = $state(false);
</script>

<Menu.Root bind:open>
  <Menu.Trigger>Actions</Menu.Trigger>
  <Menu.Content portal={false}>
    <WorkspaceActionsMenu
      layout="submenu"
      filePath="/tmp/project"
      showFileActions
      onClose={() => (open = false)}
    />
  </Menu.Content>
</Menu.Root>
