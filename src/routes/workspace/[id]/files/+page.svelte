<script lang="ts">
  import { page } from '$app/stores';
  import FileExplorerLayout from '$lib/components/file-explorer/file-explorer-layout.svelte';
  import { Button } from '$lib/components/ui/button';
  import { selectEffectiveFileExplorerWorkspacePath } from '$lib/store/slices/file-explorer/file-explorer-selectors';
  import { selectWorkspaceById } from '$lib/store/slices/workspace/workspace-selectors';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';

  let workspaceId = $derived($page.params.id ?? '');
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const workspace = selectWorkspaceById(workspaceIdStore);
  const fileExplorerWorkspacePath = selectEffectiveFileExplorerWorkspacePath(workspaceIdStore);
</script>

<div class="h-screen flex flex-col">
  <!-- Header -->
  <div class="flex items-center gap-4 px-4 py-2 border-b">
    <Button variant="ghost" size="sm" href="/workspace/{$page.params.id}">
      <Fa icon={faArrowLeft} size="sm" class="mr-2" />
      Back to Workspace
    </Button>
    {#if $workspace}
      <span class="text-sm text-subtle">
        {$workspace.name} - File Explorer
      </span>
    {/if}
  </div>

  <!-- File Explorer -->
  <div class="flex-1 overflow-hidden">
    {#if $fileExplorerWorkspacePath}
      <FileExplorerLayout {workspaceId} />
    {/if}
  </div>
</div>
