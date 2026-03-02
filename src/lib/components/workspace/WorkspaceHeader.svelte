<script lang="ts">
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('WorkspaceHeader');

  import { getWorkspaceContext } from '$features/workspace/workspace.context.svelte';
  import { Button } from '$lib/components/ui/button';
  import FileActionsDropdown from '$lib/components/ui/FileActionsDropdown.svelte';
  import { faTrash, faServer, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import DeleteWarningDialog from '$lib/components/modals/DeleteWarningDialog.svelte';
  import { hasRunningAgents, getRunningAgentNames } from '$lib/utils/delete-warning-utils';
  import { navigateAfterWorkspaceRemoval } from '$lib/utils/workspace-navigation';

  const ctx = getWorkspaceContext();

  let isDeleting = $state(false);
  let showDeleteWarning = $state(false);
  let pendingDeleteWorkspace = $state(ctx.workspace);
  let runningAgentNamesForDelete = $state<string[]>([]);

  async function handleDelete() {
    if (isDeleting || !ctx.workspace) return;

    // Check if workspace has running agents
    if (hasRunningAgents(ctx.workspace.id)) {
      // Show warning dialog instead of deleting immediately
      pendingDeleteWorkspace = ctx.workspace;
      runningAgentNamesForDelete = getRunningAgentNames(ctx.workspace.id);
      showDeleteWarning = true;
      return;
    }

    // No running agents, proceed with deletion
    await performDelete();
  }

  async function performDelete() {
    if (isDeleting || !ctx.workspace) return;
    const workspaceId = ctx.workspace.id;

    try {
      isDeleting = true;
      // Navigate first (separate error handling so deletion still proceeds)
      try {
        await navigateAfterWorkspaceRemoval(workspaceId);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (navError) {
        logger.error('[WorkspaceHeader] Failed to navigate after workspace removal:', navError);
      }
      // Delete regardless of navigation outcome
      await ctx.deleteWorkspace();
    } catch (error) {
      logger.error('Failed to delete workspace:', error);
    } finally {
      isDeleting = false;
    }
  }
</script>

<div class="px-6 py-2 border-b-[1px] flex-none border-border flex justify-between items-center">
  <div class="flex items-center flex-1 gap-2">
    <a
      href="/"
      class="text-muted-foreground text-sm hover:text-foreground transition-colors"
      aria-label="Navigate back to spaces list"
    >
      Spaces
    </a>
    <span class="text-subtle text-sm">›</span>
    <h1 class="text-sm font-medium m-0">
      {#if ctx.workspace}
        {#if ctx.workspace.title}
          <span class="text-foreground">{ctx.workspace.title}</span>
        {:else}
          <span class="text-subtle">Untitled</span>
        {/if}
      {:else}
        <span class="text-foreground">Loading...</span>
      {/if}
    </h1>

    {#if ctx.workspace?.environmentConfig?.type === 'remote'}
      <div
        class="flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded-md text-xs"
      >
        <Fa icon={faServer} size="xs" />
        <span>Remote</span>
        {#if ctx.workspace.environmentConfig.ssh}
          <span class="text-blue-400">({ctx.workspace.environmentConfig.ssh.host})</span>
        {/if}
      </div>
    {/if}

    {#if ctx.workspace?.skipWorktree === true}
      <div
        class="flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-600 rounded-md text-xs"
        title="This space operates without a git worktree. Changes are made directly in the repository."
      >
        <Fa icon={faExclamationTriangle} size="xs" />
        <span>No Worktree</span>
      </div>
    {/if}
  </div>

  <div class="flex gap-2 items-center">
    {#if ctx.workspace?.repositoryOwner && ctx.workspace?.repositoryName}
      <div class="text-xs text-subtle">
        {ctx.workspace.repositoryOwner}/{ctx.workspace.repositoryName}
      </div>
    {:else if ctx.workspace?.repositoryPath}
      <div class="text-xs text-subtle">
        {ctx.workspace.repositoryPath.split('/').pop()}
      </div>
    {/if}

    {#if ctx.workspace}
      <FileActionsDropdown
        filePath={ctx.workspace.worktreePath ||
          ctx.workspace.repositoryPath ||
          ctx.workspace.path ||
          ''}
        workspaceId={ctx.workspace.id}
        workspaceFolderPath={ctx.workspace.worktreePath || ctx.workspace.repositoryPath}
        variant="ghost"
        size="sm"
        isDirectory
        isWorkspaceRoot
      />

      <Button
        variant="ghost-light"
        size="icon-sm"
        class="-ml-2!"
        onclick={handleDelete}
        disabled={isDeleting}
        aria-label="Delete space"
        title="Delete space"
      >
        {#if isDeleting}
          <div
            class="animate-spin h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full"
            aria-hidden="true"
          ></div>
          <span class="sr-only">Deleting space...</span>
        {:else}
          <Fa icon={faTrash} size="sm" />
          <span class="sr-only">Delete</span>
        {/if}
      </Button>
    {/if}
  </div>
</div>


<!-- Delete Warning Dialog -->
<DeleteWarningDialog
  bind:open={showDeleteWarning}
  agentNames={runningAgentNamesForDelete}
  onDeleteAnyway={async () => {
    if (pendingDeleteWorkspace) {
      await performDelete();
      pendingDeleteWorkspace = null;
    }
  }}
  onCancel={() => {
    pendingDeleteWorkspace = null;
  }}
/>
