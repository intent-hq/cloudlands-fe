<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import FileExplorerLayout from '$lib/components/file-explorer/file-explorer-layout.svelte';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';

  let workspace: any = $state(null);
  let workspacePath: string = $state('');

  // Get workspace ID from URL
  $effect(() => {
    const id = $page.params.id;
    if (id) {
      workspace = workspaceStore.items.find((w) => w.id === id);
      if (workspace) {
        workspacePath = workspace.path;
      }
    }
  });
</script>

<div class="h-screen flex flex-col">
  <!-- Header -->
  <div class="flex items-center gap-4 px-4 py-2 border-b">
    <Button variant="ghost" size="sm" href="/workspace/{$page.params.id}">
      <Fa icon={faArrowLeft} size="sm" class="mr-2" />
      Back to Workspace
    </Button>
    {#if workspace}
      <span class="text-sm text-muted-foreground">
        {workspace.name} - File Explorer
      </span>
    {/if}
  </div>

  <!-- File Explorer -->
  <div class="flex-1 overflow-hidden">
    {#if workspacePath}
      <FileExplorerLayout {workspacePath} />
    {:else}{/if}
  </div>
</div>
