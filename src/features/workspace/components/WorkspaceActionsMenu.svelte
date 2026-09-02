<script lang="ts" module>
  import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
  import type { Snippet } from 'svelte';

  /**
   * Additional menu action that can be added to the workspace actions menu
   */
  export interface MenuAction {
    label: string;
    icon?: IconDefinition;
    /** Custom icon snippet (takes priority over `icon` if both are provided) */
    iconSnippet?: Snippet;
    onClick: () => void;
    dividerBefore?: boolean;
    variant?: 'default' | 'destructive';
    shortcut?: string;
    /** Marks the item as active/selected (renders a check indicator). */
    checked?: boolean;
    /** Child items expanded inline on click; `onClick` is ignored when set. */
    submenu?: MenuAction[];
  }
</script>

<script lang="ts">
  import {
    resolveEditorFallbackIcon,
    resolveEditorIcon,
  } from '$lib/components/shared/icons/editor-icon';
  import { invoke } from '$lib/electron-bridge';
  import { appClient } from '$lib/client';
  import { fetchEditors } from '$store/renderer/slices/external-editors/external-editors-slice';
  import { selectInstalledEditorsFiltered } from '$store/renderer/slices/external-editors/external-editors-selectors';
  import { selectIsWorkspaceHostLocal } from '$store/renderer/slices/workspace/workspace-selectors';

  import { createLogger } from '$lib/utils/client-logger';
  import { isAbsolutePath, toNativePath, isWindowsPlatform } from '$lib/utils/path-utils';
  import { hasCapability } from '$lib/utils/platform-capabilities';
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import { m } from '$shared/paraglide/messages.js';
  import {
    faBoxArchive,
    faBoxOpen,
    faCheck,
    faChevronDown,
    faChevronLeft,
    faFile,
    faSpinner,
    faTrash,
    faUpRightFromSquare,
  } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { toast } from 'svelte-sonner';
  import { withToastCountdown } from '$lib/components/ui/toast';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { formatShortcut } from '$lib/utils/shortcuts';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    layout?: 'list' | 'submenu';
    filePath?: string;
    workspaceId?: string;
    isDirectory?: boolean;
    onDelete?: () => void;
    onArchive?: () => void;
    onUnarchive?: () => void;
    isArchived?: boolean;
    onClose?: () => void;
    showDeleteOption?: boolean;
    showArchiveOption?: boolean;
    showFileNameCopy?: boolean;
    showFileActions?: boolean;
    workspaceFolderPath?: string;
    isDiff?: boolean;
    isWorkspaceRoot?: boolean;
    additionalActions?: MenuAction[];
    /** Show delete file option for files (not directories) */
    showDeleteFileOption?: boolean;
    /** Callback after file is deleted */
    onFileDeleted?: () => void;
  }

  let {
    layout = 'list',
    filePath = '',
    workspaceId = '',
    isDirectory = true,
    onDelete = undefined,
    onArchive = undefined,
    onUnarchive = undefined,
    isArchived = false,
    onClose = undefined,
    showDeleteOption = true,
    showArchiveOption = false,
    showFileNameCopy = false,
    showFileActions = true,
    workspaceFolderPath = '',
    isDiff = false,
    isWorkspaceRoot = false,
    additionalActions = [],
    showDeleteFileOption = false,
    onFileDeleted = undefined,
  }: Props = $props();

  const logger = createLogger('WorkspaceActionsMenu');

  // External editors / "Choose app" are Electron-only; on web only copy
  // actions are offered.
  const canOpenExternalEditors = hasCapability('externalEditors');

  // Mirror the workspaceId prop into a store so the selectors below re-run
  // when it changes.
  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect below syncs later changes
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const installedEditors$ = selectInstalledEditorsFiltered(workspaceIdStore);

  // Editors arrive priority-sorted; expose every installed editor and rely on
  // "Choose app" for applications that are not installed or enabled.
  const visibleEditors = $derived($installedEditors$);

  // Shared layout so every row's icon and label line up in the same columns.
  const menuItemClass =
    // i18n-ignore (CSS class list, not user-facing text)
    'w-full min-w-0 justify-start gap-2 pl-2! pr-2.5! focus-visible:border-transparent! focus-visible:bg-secondary focus-visible:ring-0!';
  const iconSlotClass = 'flex size-4 shrink-0 items-center justify-center';
  // "Choose app" shows a LOCAL app picker against a workspace file path, so
  // like the editor list above it, it must disappear when the daemon is
  // remote (monorepo#883) or the workspace checkout is remote (monorepo#2171).
  // Same gate as selectInstalledEditorsFiltered.
  const isWorkspaceHostLocal$ = selectIsWorkspaceHostLocal(workspaceIdStore);

  let resolvedPath: string = $state('');
  let resolvedFolderPath: string = $state('');
  let isDeletingFile = $state(false);

  // Fetch installed editors when component mounts
  onMount(() => {
    appStore.dispatch(fetchEditors());
  });

  // Get installed editors for dynamic menu

  // Resolve the absolute path
  $effect(() => {
    if (filePath && workspaceId) {
      invoke<any>('workspace:get', { id: workspaceId })
        .then((result) => {
          // Check if result exists and has valid data (not archived/deleted)
          if (result && result.success && result.data) {
            const workspace = result.data;
            const workspaceRoot = workspace.worktreePath || workspace.repositoryPath;
            const workspacePath =
              workspaceFolderPath === '__WORKSPACE_ROOT__'
                ? workspaceRoot
                : workspaceFolderPath || workspaceRoot;

            if (workspacePath) {
              const normalizedWorkspacePath = workspacePath.replace(/\\/g, '/');
              if (isWorkspaceRoot) {
                resolvedPath = normalizedWorkspacePath;
              } else if (isAbsolutePath(filePath)) {
                resolvedPath = filePath.replace(/\\/g, '/');
              } else {
                resolvedPath = `${normalizedWorkspacePath}/${filePath}`.replace(/\/+/g, '/');
              }
              resolvedFolderPath = normalizedWorkspacePath;
              logger.info('[WorkspaceActionsMenu] Resolved file path:', {
                filePath,
                workspacePath,
                resolvedPath,
              });
            } else {
              resolvedPath = filePath;
              resolvedFolderPath = '';
              // Only warn if workspace exists but has no path (not for deleted workspaces)
              if (workspace.status !== 'archived' && workspace.status !== 'deleted') {
                logger.warn('[WorkspaceActionsMenu] No workspace path found:', workspace);
              }
            }
          } else {
            resolvedPath = filePath;
            resolvedFolderPath = '';
            // Don't warn for archived/deleted workspaces
            if (result?.error && !result.error.includes('not found')) {
              logger.warn('[WorkspaceActionsMenu] Workspace not available:', result);
            }
          }
        })
        .catch((error) => {
          resolvedPath = filePath;
          resolvedFolderPath = '';
          // Only log error if it's not a "not found" error (which is expected for deleted workspaces)
          if (!error?.message?.includes('not found')) {
            logger.error('[WorkspaceActionsMenu] Failed to resolve path:', error);
          }
        });
    } else {
      resolvedPath = filePath;
      logger.info('[WorkspaceActionsMenu] Using filePath directly:', {
        filePath,
        workspaceId,
      });
    }
  });

  async function openInVSCode() {
    if (!resolvedPath) {
      logger.warn('[WorkspaceActionsMenu] No resolved path for VSCode');
      return;
    }
    try {
      // If this is a diff view, open VSCode with the file in git context
      if (isDiff && !isDirectory) {
        logger.info('[WorkspaceActionsMenu] Opening diff in VSCode:', { resolvedPath });

        // Open VSCode with the repository context so it can show git diffs natively
        // Users can then:
        // 1. Click on the gutter indicators (colored bars on line numbers) to see inline diffs
        // 2. Use Ctrl/Cmd+Shift+G to open Source Control panel
        // 3. Use Command Palette > "Git: Open Changes" to see the full diff
        await invoke('vscode:open-git-diff', {
          filePath: resolvedPath,
          workspacePath: resolvedFolderPath || undefined,
        });
        onClose?.();
        return;
      }

      // Regular file/folder opening
      let pathToOpen: string | { folder: string; file: string } = resolvedPath;

      // Always prefer opening with workspace context when available
      if (resolvedFolderPath) {
        if (!isDirectory && !isWorkspaceRoot) {
          // For files, always open the workspace folder first, then the file
          // This ensures VSCode opens in the correct workspace context
          pathToOpen = { folder: resolvedFolderPath, file: resolvedPath };
        } else {
          // For directories or workspace root, just open the folder
          pathToOpen = resolvedFolderPath;
        }
      } else if (!isDirectory) {
        // Fallback: if no workspace folder but we have a file, try to derive the workspace
        // from the file path (go up to find .git directory or use parent directory)
        // Handle both forward and backward slashes for cross-platform compatibility
        const separator = resolvedPath.includes('\\') ? '\\' : '/';
        const pathParts = resolvedPath.split(separator);
        if (pathParts.length > 1) {
          // Use parent directory as workspace
          const parentDir = pathParts.slice(0, -1).join(separator);
          pathToOpen = { folder: parentDir, file: resolvedPath };
        }
      }

      await invoke('vscode:open', pathToOpen);
      onClose?.();
    } catch (error) {
      logger.error('Failed to open in VSCode:', error);
      // i18n-ignore (brand name)
      toast.error(
        error instanceof Error
          ? error.message
          : m.ui_workspaceActions_openFailed_error({ name: 'VS Code' }),
      );
    }
  }

  async function openInJetBrains() {
    if (!resolvedPath) {
      logger.warn('[WorkspaceActionsMenu] No resolved path for JetBrains');
      return;
    }
    try {
      // If we have a resolved folder path, open the workspace folder with the file
      // Otherwise just open the file/folder
      let pathToOpen: string | { folder: string; file: string } = resolvedPath;

      if (resolvedFolderPath && !isDirectory) {
        // For files with a workspace folder, pass both folder and file
        pathToOpen = { folder: resolvedFolderPath, file: resolvedPath };
      } else if (resolvedFolderPath) {
        // For directories, just open the workspace folder
        pathToOpen = resolvedFolderPath;
      }

      await invoke('jetbrains:open', pathToOpen);
      onClose?.();
    } catch (error) {
      logger.error('Failed to open in JetBrains:', error);
      // i18n-ignore (brand name)
      toast.error(
        error instanceof Error
          ? error.message
          : m.ui_workspaceActions_openFailed_error({ name: 'JetBrains' }),
      );
    }
  }

  async function openInXcode() {
    if (!resolvedPath) {
      logger.warn('[WorkspaceActionsMenu] No resolved path for Xcode');
      return;
    }
    try {
      // Fetch changed files to help find the right Xcode project in monorepos.
      // Daemon-backed read (`git.status`, PROTOCOL §5.6) via the appClient seam.
      let changedFiles: string[] = [];
      if (workspaceId && resolvedFolderPath) {
        try {
          const status = await appClient.git.status(workspaceId);
          if (status?.files) {
            changedFiles = status.files.map((f) => f.path);
            logger.info('[WorkspaceActionsMenu] Found changed files for Xcode', {
              count: changedFiles.length,
            });
          }
        } catch (err) {
          // Non-fatal - we can still open Xcode without changed files
          logger.debug('[WorkspaceActionsMenu] Could not get changed files for Xcode', err);
        }
      }

      // If we have a resolved folder path, open the workspace folder with the file
      // Otherwise just open the file/folder
      let pathToOpen: string | { folder: string; file?: string; changedFiles?: string[] } =
        resolvedPath;

      if (resolvedFolderPath && !isDirectory) {
        // For files with a workspace folder, pass both folder and file
        pathToOpen = {
          folder: resolvedFolderPath,
          file: resolvedPath,
          changedFiles: changedFiles.length > 0 ? changedFiles : undefined,
        };
      } else if (resolvedFolderPath) {
        // For directories, just open the workspace folder with changed files for smart detection
        pathToOpen = {
          folder: resolvedFolderPath,
          changedFiles: changedFiles.length > 0 ? changedFiles : undefined,
        };
      }

      await invoke('xcode:open', pathToOpen);
      onClose?.();
    } catch (error) {
      logger.error('Failed to open in Xcode:', error);
      // i18n-ignore (brand name)
      toast.error(
        error instanceof Error
          ? error.message
          : m.ui_workspaceActions_openFailed_error({ name: 'Xcode' }),
      );
    }
  }

  /**
   * Generic handler for opening in any editor based on its handler type
   */
  async function openInEditor(editor: { id: string; appName: string; handlerType: string }) {
    logger.info('[WorkspaceActionsMenu] openInEditor called', {
      editorId: editor.id,
      appName: editor.appName,
      handlerType: editor.handlerType,
      resolvedPath,
      isDirectory,
    });

    if (!resolvedPath) {
      logger.warn('[WorkspaceActionsMenu] openInEditor: No resolved path, aborting');
      return;
    }

    const targetPath = isDirectory
      ? resolvedPath
      : resolvedPath.substring(0, resolvedPath.lastIndexOf('/'));

    logger.info(
      `[WorkspaceActionsMenu] openInEditor: targetPath=${targetPath}, handlerType=${editor.handlerType}`,
    );

    try {
      switch (editor.handlerType) {
        case 'finder':
          logger.info('[WorkspaceActionsMenu] openInEditor: Invoking shell:showItemInFolder');
          await invoke('shell:showItemInFolder', { path: targetPath });
          break;
        case 'vscode':
          logger.info('[WorkspaceActionsMenu] openInEditor: Delegating to openInVSCode');
          await openInVSCode();
          return; // openInVSCode already handles onClose
        case 'jetbrains':
          logger.info('[WorkspaceActionsMenu] openInEditor: Delegating to openInJetBrains');
          await openInJetBrains();
          return; // openInJetBrains already handles onClose
        case 'xcode':
          logger.info('[WorkspaceActionsMenu] openInEditor: Delegating to openInXcode');
          await openInXcode();
          return; // openInXcode already handles onClose
        case 'generic':
        default: {
          // Use the editor ID to open via the external-editors handler
          logger.info(
            // i18n-ignore (log line)
            `[WorkspaceActionsMenu] openInEditor: Invoking external-editors:open for ${editor.id}`,
          );
          const result = await invoke('external-editors:open', {
            editorId: editor.id,
            path: targetPath,
          });
          logger.info('[WorkspaceActionsMenu] openInEditor: external-editors:open result', result);
          break;
        }
      }
      onClose?.();
    } catch (error) {
      logger.error(`[WorkspaceActionsMenu] Failed to open in ${editor.appName}:`, error);
      toast.error(
        error instanceof Error
          ? error.message
          : m.ui_workspaceActions_openFailed_error({ name: editor.appName }),
      );
    }
  }

  /**
   * Open with a user-selected app (shows file picker)
   */
  async function openWithOther() {
    if (!resolvedPath) {
      logger.warn('No resolved path for openWithOther');
      return;
    }

    try {
      // Determine what path to open
      let pathToOpen = resolvedPath;

      // For files, we might want to open the containing folder
      // depending on the app, but for now just open the file/folder directly
      if (isDirectory && resolvedFolderPath) {
        pathToOpen = resolvedFolderPath;
      }

      const result = await invoke<{ success: boolean; appName?: string; error?: string }>(
        'external-editors:open-with-other',
        { path: pathToOpen },
      );

      if (!result?.success) {
        // User cancelled or error - don't log/toast for a user cancel; surface
        // every other failure (bridge-absent, spawn error) as a toast so the
        // action fails loudly instead of silently no-oping.
        // i18n-ignore (IPC sentinel string from the main process, not UI copy)
        if (result?.error !== 'No application selected') {
          logger.error('Failed to open with other app:', result?.error);
          toast.error(result?.error || m.ui_workspaceActions_openOtherFailed_error());
        }
        return;
      }

      onClose?.();
    } catch (error) {
      logger.error('Failed to open with other app:', error);
      toast.error(
        error instanceof Error ? error.message : m.ui_workspaceActions_openOtherFailed_error(),
      );
    }
  }

  async function copyAbsolutePath() {
    if (!resolvedPath) return;
    try {
      await navigator.clipboard.writeText(toNativePath(resolvedPath));
      onClose?.();
    } catch (error) {
      logger.error('Failed to copy path:', error);
    }
  }

  async function copyWorkspacePath() {
    if (!filePath) return;
    try {
      // If the path is already absolute and we have a workspace folder path,
      // make it relative to the workspace
      let pathToCopy = filePath.replace(/\\/g, '/');

      if (isAbsolutePath(filePath) && resolvedFolderPath) {
        // Convert absolute path to relative by removing the workspace prefix
        const workspacePrefix = resolvedFolderPath.endsWith('/')
          ? resolvedFolderPath
          : resolvedFolderPath + '/';

        if (pathToCopy.startsWith(workspacePrefix)) {
          pathToCopy = pathToCopy.slice(workspacePrefix.length);
        }
      }

      await navigator.clipboard.writeText(toNativePath(pathToCopy));
      onClose?.();
    } catch (error) {
      logger.error('Failed to copy workspace path:', error);
    }
  }

  async function copyFileName() {
    if (!filePath) return;
    try {
      const fileName = filePath.split(/[/\\]/).pop() || '';
      await navigator.clipboard.writeText(fileName);
      onClose?.();
    } catch (error) {
      logger.error('Failed to copy file name:', error);
    }
  }

  function handleDelete() {
    if (onDelete) {
      onDelete();
      onClose?.();
    }
  }

  async function handleDeleteFile() {
    if (!workspaceId || !resolvedPath || isDeletingFile) return;

    isDeletingFile = true;
    try {
      const fileName = filePath.split(/[/\\]/).pop() || 'file';
      const pathToDelete = resolvedPath;

      // Read file content before deleting so we can undo
      let savedContent = '';
      try {
        const readResult = await invoke<{
          success: boolean;
          data: { content: string; isBinary?: boolean };
        }>('file:read', { path: pathToDelete, workspaceId });
        savedContent = readResult?.data?.content ?? '';
      } catch {
        // If we can't read the file, proceed with delete but undo won't restore content
      }

      const result = await invoke<{ success: boolean; error?: string }>('file:delete', {
        path: pathToDelete,
        workspaceId,
      });

      if (result?.success) {
        onFileDeleted?.();
        onClose?.();

        const toastId = toast.warning(
          m.ui_workspaceActions_deletedFile_label({ name: fileName }),
          withToastCountdown({
            duration: 15000,
            action: {
              label: m.ui_workspaceActions_undo_label(),
              onClick: async () => {
                try {
                  await invoke('file:write', {
                    path: pathToDelete,
                    content: savedContent,
                    workspaceId,
                  });
                  dispatchWindowEvent('file:changed', {
                    workspaceId,
                    type: 'create',
                    filePath: pathToDelete,
                  });
                  toast.dismiss(toastId);
                } catch (err) {
                  logger.error('[WorkspaceActionsMenu] Failed to restore file', err);
                  toast.error(m.ui_workspaceActions_restoreFileFailed_error());
                }
              },
            },
          }),
        );
      } else {
        toast.error(
          m.ui_workspaceActions_deleteFileFailedDetail_error({
            error: result?.error || m.ui_workspaceActions_unknown_error(),
          }),
        );
      }
    } catch (err) {
      logger.error('[WorkspaceActionsMenu] Error deleting file', err);
      toast.error(m.ui_workspaceActions_deleteFileFailed_error());
    } finally {
      isDeletingFile = false;
    }
  }

  function handleArchive() {
    if (isArchived && onUnarchive) {
      onUnarchive();
      onClose?.();
    } else if (!isArchived && onArchive) {
      onArchive();
      onClose?.();
    }
  }

  // Inline-expanded submenu (label-keyed); one open at a time.
  let openSubmenuLabel: string | null = $state(null);

  function handleActionClick(action: MenuAction) {
    if (action.submenu) {
      openSubmenuLabel = openSubmenuLabel === action.label ? null : action.label;
      return;
    }
    action.onClick();
    onClose?.();
  }
</script>

<div class="w-full overflow-hidden">
  {#if showFileActions && layout === 'submenu'}
    <Menu.Sub>
      <Menu.SubTrigger>
        <Fa icon={faUpRightFromSquare} size="12" class="w-4 text-muted-foreground opacity-70" />
        <span>{m.ui_openCombo_openInApp_tooltip()}</span>
      </Menu.SubTrigger>
      <Menu.SubContent class="w-60">
        {#if canOpenExternalEditors && $isWorkspaceHostLocal$}
          {#each visibleEditors as editor (editor.id)}
            {@const IconComponent = resolveEditorIcon(editor)}
            <Menu.Item onclick={() => openInEditor(editor)}>
              <span class={iconSlotClass} aria-hidden="true">
                {#if editor.iconBase64}
                  <img
                    src="data:image/png;base64,{editor.iconBase64}"
                    alt={editor.name}
                    class="size-4"
                  />
                {:else if IconComponent}
                  <IconComponent size={12} />
                {:else}
                  <Fa
                    icon={resolveEditorFallbackIcon(editor.category)}
                    size="12"
                    class="opacity-50"
                  />
                {/if}
              </span>
              <span class="min-w-0 flex-1 truncate">
                {m.ui_workspaceActions_openIn_label({ name: editor.name })}
              </span>
            </Menu.Item>
          {/each}

          <Menu.Item onclick={openWithOther}>
            <span class={iconSlotClass} aria-hidden="true">
              <Fa icon={faUpRightFromSquare} size="12" class="opacity-50" />
            </span>
            <span class="min-w-0 flex-1 truncate">{m.ui_workspaceActions_chooseApp_label()}</span>
          </Menu.Item>
          <Menu.Separator />
        {/if}

        <Menu.Item onclick={copyAbsolutePath}>
          <span class="{iconSlotClass} text-xs font-black font-mono opacity-50" aria-hidden="true">
            {isWindowsPlatform() ? '\\' : '/'}
          </span>
          <span class="min-w-0 flex-1 truncate">
            {m.ui_workspaceActions_copyAbsolutePath_label()}
          </span>
        </Menu.Item>

        {#if !isWorkspaceRoot}
          <Menu.Item onclick={copyWorkspacePath}>
            <span class="{iconSlotClass} text-xs font-black font-mono opacity-50" aria-hidden="true"
              >./</span
            >
            <span class="min-w-0 flex-1 truncate">
              {m.ui_workspaceActions_copyRelativePath_label()}
            </span>
          </Menu.Item>
        {/if}

        {#if showFileNameCopy && !isDirectory}
          <Menu.Item onclick={copyFileName}>
            <span class={iconSlotClass} aria-hidden="true">
              <Fa icon={faFile} size="12" class="opacity-50" />
            </span>
            <span class="min-w-0 flex-1 truncate">
              {m.ui_workspaceActions_copyFileName_label()}
            </span>
          </Menu.Item>
        {/if}
      </Menu.SubContent>
    </Menu.Sub>
  {:else if showFileActions}
    {#if canOpenExternalEditors && $isWorkspaceHostLocal$}
      <!-- Open Actions - dynamically rendered based on installed editors -->
      <div class="space-y-0.5">
        {#each visibleEditors as editor (editor.id)}
          {@const IconComponent = resolveEditorIcon(editor)}
          <Button
            variant="ghost"
            onclick={() => openInEditor(editor)}
            class={menuItemClass}
            size="sm"
          >
            <span class={iconSlotClass}>
              {#if editor.iconBase64}
                <img
                  src="data:image/png;base64,{editor.iconBase64}"
                  alt={editor.name}
                  class="size-4"
                />
              {:else if IconComponent}
                <IconComponent size={12} />
              {:else}
                <Fa
                  icon={resolveEditorFallbackIcon(editor.category)}
                  size="12"
                  class="opacity-50"
                />
              {/if}
            </span>
            <span
              class="truncate min-w-0"
              title={m.ui_workspaceActions_openIn_label({ name: editor.name })}
              >{m.ui_workspaceActions_openIn_label({ name: editor.name })}</span
            >
          </Button>
        {/each}

        <!-- Other... option to pick any app -->
        <Button
          variant="ghost"
          onclick={openWithOther}
          class="{menuItemClass} text-subtle"
          size="sm"
        >
          <span class={iconSlotClass}>
            <Fa icon={faUpRightFromSquare} size="12" class="opacity-50" />
          </span>
          <span class="truncate min-w-0" title={m.ui_workspaceActions_chooseApp_label()}
            >{m.ui_workspaceActions_chooseApp_label()}</span
          >
        </Button>
      </div>
      <div class="my-1 h-px bg-border"></div>
    {/if}

    <!-- Copy Actions -->
    <div class="space-y-0.5">
      <Button variant="ghost" onclick={copyAbsolutePath} class={menuItemClass} size="sm">
        <span class="{iconSlotClass} text-xs font-black font-mono opacity-50">
          {isWindowsPlatform() ? '\\' : '/'}
        </span>
        <span class="truncate min-w-0" title={m.ui_workspaceActions_copyAbsolutePath_label()}
          >{m.ui_workspaceActions_copyAbsolutePath_label()}</span
        >
      </Button>

      {#if !isWorkspaceRoot}
        <Button variant="ghost" onclick={copyWorkspacePath} class={menuItemClass} size="sm">
          <span class="{iconSlotClass} text-xs font-black font-mono opacity-50">./</span>
          <span class="truncate min-w-0" title={m.ui_workspaceActions_copyRelativePath_label()}
            >{m.ui_workspaceActions_copyRelativePath_label()}</span
          >
        </Button>
      {/if}

      {#if showFileNameCopy && !isDirectory}
        <Button variant="ghost" onclick={copyFileName} class={menuItemClass} size="sm">
          <span class={iconSlotClass}>
            <Fa icon={faFile} size="12" class="opacity-50" />
          </span>
          <span class="truncate min-w-0" title={m.ui_workspaceActions_copyFileName_label()}
            >{m.ui_workspaceActions_copyFileName_label()}</span
          >
        </Button>
      {/if}
    </div>
  {/if}

  <!-- Additional Actions -->
  {#if additionalActions.length > 0}
    {#each additionalActions as action, i (`action-${i}-${action.label}`)}
      {#if action.dividerBefore}
        <div class="my-1 h-px bg-border"></div>
      {/if}
      <Button
        variant="ghost"
        onclick={() => handleActionClick(action)}
        class="{menuItemClass} {action.variant === 'destructive'
          ? 'hover:bg-danger hover:text-danger-background'
          : ''}"
        size="sm"
      >
        <span class={iconSlotClass}>
          {#if action.iconSnippet}
            {@render action.iconSnippet()}
          {:else if action.icon}
            <Fa icon={action.icon} size="12" class="opacity-50" />
          {/if}
        </span>
        <span class="truncate min-w-0" title={action.label}>{action.label}</span>
        {#if action.submenu}
          <Fa
            icon={openSubmenuLabel === action.label ? faChevronDown : faChevronLeft}
            size="12"
            class="ml-auto opacity-50"
          />
        {:else if action.shortcut}
          <kbd class="type-caption ml-auto shrink-0 font-normal text-subtle">
            {formatShortcut(action.shortcut)}
          </kbd>
        {/if}
      </Button>
      {#if action.submenu && openSubmenuLabel === action.label}
        {#each action.submenu as subaction (`sub-${subaction.label}`)}
          <Button
            variant="ghost"
            onclick={() => {
              subaction.onClick();
              onClose?.();
            }}
            class="pl-8! gap-2.25! w-full min-w-0 justify-start"
            size="sm"
          >
            <span class="truncate min-w-0" title={subaction.label}>{subaction.label}</span>
            {#if subaction.checked}
              <Fa icon={faCheck} size="12" class="ml-auto opacity-50" />
            {/if}
          </Button>
        {/each}
      {/if}
    {/each}
  {/if}

  <!-- Archive Action -->
  {#if showArchiveOption && (onArchive || onUnarchive)}
    <Button variant="ghost" onclick={handleArchive} class={menuItemClass} size="sm">
      <span class={iconSlotClass}>
        <Fa icon={isArchived ? faBoxOpen : faBoxArchive} size="12" class="opacity-50" />
      </span>
      <span
        class="truncate"
        title={isArchived
          ? m.ui_workspaceActions_unarchiveSpace_label()
          : m.ui_workspaceActions_archiveSpace_label()}
        >{isArchived
          ? m.ui_workspaceActions_unarchiveSpace_label()
          : m.ui_workspaceActions_archiveSpace_label()}</span
      >
    </Button>
  {/if}

  <!-- Delete Action -->
  {#if showDeleteOption && onDelete}
    <Button
      variant="ghost"
      onclick={handleDelete}
      class="{menuItemClass} hover:bg-danger hover:text-danger-background"
      size="sm"
    >
      <span class={iconSlotClass}>
        <Fa icon={faTrash} size="12" class="opacity-50" />
      </span>
      <span class="truncate min-w-0" title={m.ui_workspaceActions_deleteSpace_label()}
        >{m.ui_workspaceActions_deleteSpace_label()}</span
      >
    </Button>
  {/if}

  <!-- Delete File Action -->
  {#if showDeleteFileOption && !isDirectory}
    <div class="my-1 h-px bg-border"></div>
    <Button
      variant="ghost"
      onclick={handleDeleteFile}
      disabled={isDeletingFile}
      class="{menuItemClass} hover:bg-danger hover:text-danger-background"
      size="sm"
    >
      <span class={iconSlotClass}>
        {#if isDeletingFile}
          <Fa icon={faSpinner} size="12" class="opacity-50 animate-spin" />
        {:else}
          <Fa icon={faTrash} size="12" class="opacity-50" />
        {/if}
      </span>
      <span class="truncate min-w-0" title={m.ui_workspaceActions_deleteFile_label()}
        >{m.ui_workspaceActions_deleteFile_label()}</span
      >
    </Button>
  {/if}
</div>
