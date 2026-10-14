<script lang="ts">
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import WorkspaceActionsMenu from '$features/workspace/components/WorkspaceActionsMenu.svelte';

  let {
    filePath = '/tmp/project',
    workspaceId = '',
    isDirectory = true,
  }: {
    filePath?: string;
    workspaceId?: string;
    isDirectory?: boolean;
  } = $props();
  let open = $state(false);
</script>

<DropdownMenu bind:open portal={false}>
  {#snippet trigger({ props })}
    <button {...props}>Actions</button>
  {/snippet}
  {#snippet content({ close })}
    <WorkspaceActionsMenu
      layout="menu"
      {filePath}
      {workspaceId}
      {isDirectory}
      showDeleteOption={false}
      onClose={close}
    />
  {/snippet}
</DropdownMenu>
