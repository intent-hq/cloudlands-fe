<script lang="ts">
  /**
   * FileRow - A single file in the timeline
   * Minimal, sleek design with hover actions
   */
  import Fa from 'svelte-fa';
  import {
    faPlus,
    faMinus,
    faRotateLeft,
    faFileAlt,
    faArrowUpRightFromSquare,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import type { UIFileChange } from './types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import {
    getSidebarContextPosition,
    type SidebarContextPosition,
  } from '$lib/components/ui/sidebar-context-menu/types';
  import { m } from '$shared/paraglide/messages.js';
  import { isCmdClickModifier } from '$shared/utils/link-helpers';

  interface Props {
    file: UIFileChange;
    /** Workspace/root/commit scope supplied by the host, independent of file labels. */
    contextKey?: string;
    /** Compact, unfilled rows for staged and unstaged changes. */
    compact?: boolean;
    showStageAction?: boolean;
    showRevertAction?: boolean;
    muted?: boolean;
    doShowIcon?: boolean;
    /** Whether this file row is the currently active/selected one */
    active?: boolean;
    /** Whether this file is locked (agent is working, auto-commit pending) */
    locked?: boolean;
    /** Whether this file is selected for bulk operations */
    selected?: boolean;
    /** Whether this file has keyboard focus */
    focused?: boolean;
    onFileClick?: (
      path: string,
      commitHash?: string,
      staged?: boolean,
      event?: MouseEvent | KeyboardEvent,
    ) => void;
    /** Called when file is shift+clicked for multi-select */
    onSelectClick?: (path: string, event: MouseEvent) => void;
    onStage?: (path: string) => void;
    onUnstage?: (path: string) => void;
    onRevert?: (path: string) => void;
    /** Callback to open the file in the external editor (e.g., VS Code) */
    onOpenFile?: (path: string) => void;
    activeInPanel?: boolean;
  }

  let {
    file,
    contextKey = '',
    compact = false,
    showStageAction = false,
    showRevertAction = false,
    muted = false,
    doShowIcon = true,
    active = false,
    locked = false,
    selected = false,
    focused = false,
    onFileClick,
    onSelectClick,
    onStage,
    onUnstage,
    onRevert,
    onOpenFile,
    activeInPanel = false,
  }: Props = $props();

  // Context menu state
  let rowButton: HTMLButtonElement | null = $state(null);
  let contextMenu:
    (SidebarContextPosition & { path: string; staged: boolean; key: string }) | null = $state(null);

  function handleContextMenu(e: MouseEvent | KeyboardEvent) {
    const position = getSidebarContextPosition(e);
    if (!position) return;
    contextMenu = {
      ...position,
      returnFocus: rowButton,
      path: file.path,
      staged: file.staged,
      key: contextKey,
    };
  }

  function isContextTargetCurrent(target: typeof contextMenu): boolean {
    return (
      !!target &&
      target.path === file.path &&
      target.staged === file.staged &&
      target.key === contextKey
    );
  }

  $effect(() => {
    if (contextMenu && !isContextTargetCurrent(contextMenu)) closeContextMenu();
  });

  function closeContextMenu() {
    contextMenu = null;
  }

  // Use locked from prop or from file object
  const isLocked = $derived(locked || file.locked || false);

  // Check if any action buttons will be shown on hover
  // Only hide the LineChangesBadge on hover if actions will appear
  const hasActions = $derived(
    onOpenFile || (!isLocked && (showStageAction || (showRevertAction && !file.staged))),
  );

  const fileName = $derived(file.path.split('/').pop() || file.path);
  const dirPath = $derived(
    file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '',
  );

  // Determine the type of change
  // Uses status field if available, falls back to stats-based heuristic
  const changeType = $derived.by(() => {
    // Use explicit status if available
    if (file.status === 'added') return 'added';
    if (file.status === 'deleted') return 'deleted';
    if (file.status === 'modified' || file.status === 'renamed') return 'modified';

    // Fallback to stats-based heuristic (for backward compatibility)
    if (file.additions > 0 && file.deletions === 0) return 'added';
    if (file.deletions > 0 && file.additions === 0) return 'deleted';
    return 'modified';
  });

  // Get the appropriate tooltip for the revert/discard/restore action
  const revertTooltip = $derived.by(() => {
    switch (changeType) {
      case 'added':
        return m.fileTracking_changes_deleteNewFile_tooltip();
      case 'deleted':
        return m.fileTracking_changes_restoreDeletedFile_tooltip();
      default:
        return m.fileTracking_changes_discardChanges_tooltip();
    }
  });

  // Build context menu items based on available actions
  function getContextMenuItems(): SidebarMenuEntry[] {
    const items: SidebarMenuEntry[] = [
      {
        id: 'open',
        label: m.fileExplorer_tree_open_label(),
        icon: faArrowUpRightFromSquare,
        onClick: (event?: MouseEvent) => {
          onFileClick?.(file.path, undefined, file.staged, event);
          closeContextMenu();
        },
      },
    ];

    // Add "Open File" if callback is provided
    if (onOpenFile) {
      items.push({
        id: 'open-file',
        label: m.fileTracking_fileRow_openFile_label(),
        icon: faFileAlt,
        onClick: () => {
          onOpenFile?.(file.path);
          closeContextMenu();
        },
      });
    }

    // Don't show actions if locked
    if (!isLocked) {
      // Stage/Unstage action
      if (showStageAction) {
        items.push({ type: 'separator' });
        items.push({
          id: file.staged ? 'unstage' : 'stage',
          label: file.staged
            ? m.fileTracking_fileRow_unstage_label()
            : m.fileTracking_fileRow_stage_label(),
          icon: file.staged ? faMinus : faPlus,
          onClick: () => {
            if (file.staged) {
              onUnstage?.(file.path);
            } else {
              onStage?.(file.path);
            }
            closeContextMenu();
          },
        });
      }

      // Revert action (for unstaged files)
      if (showRevertAction && !file.staged) {
        items.push({ type: 'separator' });
        items.push({
          id: 'revert',
          label: revertTooltip,
          icon: faRotateLeft,
          destructive: true,
          onClick: () => {
            onRevert?.(file.path);
            closeContextMenu();
          },
        });
      }
    }

    const target = contextMenu;
    return items.map((item) =>
      'onClick' in item
        ? {
            ...item,
            onClick: () => {
              if (contextMenu !== target || !isContextTargetCurrent(target)) return;
              if (['stage', 'unstage', 'revert'].includes(item.id) && isLocked) return;
              if ((item.id === 'stage' || item.id === 'unstage') && !showStageAction) return;
              if (item.id === 'revert' && (!showRevertAction || file.staged)) return;
              item.onClick();
            },
          }
        : item,
    );
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="group/row relative flex items-center gap-1 w-full text-left rounded border {compact
    ? 'h-7 pr-2'
    : '-mx-1 -mb-px pl-1'} {muted ? 'text-muted-foreground' : ''} {active || selected || focused
    ? 'bg-background text-foreground border-transparent'
    : 'border-transparent'}"
  oncontextmenu={handleContextMenu}
>
  <Button
    bind:ref={rowButton}
    type="button"
    variant={compact ? 'ghost' : 'default'}
    size={compact ? 'compact' : undefined}
    wrapContent={!compact}
    aria-current={activeInPanel ? 'page' : undefined}
    class="flex-1 min-w-0 pr-2 py-0.5 flex items-center gap-1.5 rounded transition-colors cursor-pointer focus:ring-0 focus:outline-0 {compact
      ? 'h-full px-2 py-0 justify-start'
      : ''}"
    onclick={(e: MouseEvent) => {
      // If shift is pressed, handle as selection
      if (e.shiftKey && onSelectClick) {
        onSelectClick(file.path, e);
      } else {
        onFileClick?.(file.path, undefined, file.staged, e);
      }
    }}
    onkeydown={(event: KeyboardEvent) => {
      handleContextMenu(event);
      if (event.defaultPrevented) return;
      if (event.key !== 'Enter' || !isCmdClickModifier({ event })) return;
      event.preventDefault();
      onFileClick?.(file.path, undefined, file.staged, event);
    }}
  >
    <!-- File info -->
    <div class="flex-1 min-w-0 flex items-center gap-1.5">
      {#if doShowIcon}
        <Fa icon={faFileAlt} class="h-3! w-3! text-ghost shrink-0" />
      {/if}
      <span
        class="text-ui max-w-full shrink-0 truncate {muted
          ? 'text-muted-foreground'
          : 'text-foreground'} {changeType === 'deleted' ? 'file-deleted' : ''}"
      >
        {fileName}
      </span>
      {#if dirPath}
        <span class="text-ui text-subtle truncate">{dirPath}</span>
      {/if}
    </div>
  </Button>

  <!-- Action buttons container - shown on hover -->
  {#if hasActions}
    <div
      class="absolute flex items-center {compact
        ? 'right-2'
        : 'right-0'} top-1/2 transform -translate-y-1/2 {active || selected || focused
        ? 'bg-background'
        : 'bg-sidebar'} opacity-0 group-hover/row:opacity-100 transition-transform translate-x-1 group-hover/row:translate-x-0 pointer-events-none group-hover/row:pointer-events-auto"
    >
      <!-- Open file action -->
      {#if onOpenFile}
        <Button
          variant="ghost-light"
          size="icon-xs"
          class="size-5 shrink-0"
          onclick={(e: MouseEvent) => {
            e.stopPropagation();
            onOpenFile?.(file.path);
          }}
          tooltip={m.fileTracking_fileRow_openFile_tooltip()}
          aria-label={m.fileTracking_fileRow_openFile_tooltip()}
        >
          <Fa icon={faFileAlt} class="h-2.5! w-2.5!" />
        </Button>
      {/if}

      <!-- Revert/Discard/Restore action (for unstaged files) -->
      {#if !isLocked && showRevertAction && !file.staged}
        <Button
          variant="ghost-light"
          size="icon-xs"
          class="size-5 shrink-0"
          onclick={(e: MouseEvent) => {
            e.stopPropagation();
            onRevert?.(file.path);
          }}
          tooltip={revertTooltip}
          aria-label={revertTooltip}
        >
          <Fa icon={faRotateLeft} class="h-2.5! w-2.5!" />
        </Button>
      {/if}

      <!-- Stage/Unstage action -->
      {#if !isLocked && showStageAction}
        <Button
          variant="ghost-light"
          size="icon-xs"
          class="size-5 shrink-0"
          onclick={(e: MouseEvent) => {
            e.stopPropagation();
            if (file.staged) {
              onUnstage?.(file.path);
            } else {
              onStage?.(file.path);
            }
          }}
          tooltip={file.staged
            ? m.fileTracking_fileRow_unstage_label()
            : m.fileTracking_fileRow_stage_label()}
          aria-label={file.staged
            ? m.fileTracking_fileRow_unstage_label()
            : m.fileTracking_fileRow_stage_label()}
        >
          <Fa icon={file.staged ? faMinus : faPlus} class="h-2.5! w-2.5!" />
        </Button>
      {/if}
    </div>
  {/if}
  <div
    class="flex-0 pointer-events-none {hasActions
      ? 'group-hover/row:opacity-0 transform transition-transform group-hover/row:translate-x-1'
      : ''}"
  >
    <LineChangesBadge additions={file.additions} deletions={file.deletions} size="xs" />
  </div>
</div>

{#if contextMenu}
  <SidebarContextMenu
    x={contextMenu?.x ?? 0}
    y={contextMenu?.y ?? 0}
    ariaLabel={file.path}
    returnFocus={contextMenu?.returnFocus}
    items={getContextMenuItems()}
    onClickOutside={closeContextMenu}
  />
{/if}

<style>
  .file-deleted {
    text-decoration: line-through;
    opacity: 0.7;
  }
</style>
