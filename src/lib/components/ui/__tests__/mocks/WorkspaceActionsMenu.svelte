<script lang="ts">
  // Props match the real WorkspaceActionsMenu interface for mock compatibility
  // Using _ prefix to mark as intentionally unused in this mock
  export let filePath: string = '';
  export let workspaceId: string = '';
  export let isDirectory: boolean = false;
  export let workspaceFolderPath: string = '';
  export let isDiff: boolean = false;
  export let isWorkspaceRoot: boolean = false;
  export let additionalActions: any[] = [];
  export let onClose: (() => void) | undefined = undefined;
  export let onArchive: (() => void) | undefined = undefined;
  export let onUnarchive: (() => void) | undefined = undefined;
  export let isArchived: boolean = false;
  export let showDeleteOption: boolean = false;
  export let showArchiveOption: boolean = false;
  export let showFileNameCopy: boolean = true;

  // Reference the props to avoid unused variable warnings
  (void filePath,
    workspaceId,
    isDirectory,
    workspaceFolderPath,
    isDiff,
    isWorkspaceRoot,
    showDeleteOption,
    showArchiveOption,
    showFileNameCopy,
    onArchive,
    onUnarchive,
    isArchived);
</script>

<div class="workspace-actions-menu">
  <button type="button" class="menu-action" onclick={() => onClose?.()}> Action 1 </button>
  <button type="button" class="menu-action" onclick={() => onClose?.()}> Action 2 </button>
  {#each additionalActions as action, actionIndex (`action-${actionIndex}-${action.label}`)}
    <button
      type="button"
      class="menu-action"
      onclick={() => {
        action.action?.();
        onClose?.();
      }}
    >
      {action.label}
    </button>
  {/each}
</div>
