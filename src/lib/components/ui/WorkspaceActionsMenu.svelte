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
  }
</script>

<script lang="ts">
  import CursorCodeIcon from '$lib/components/shared/icons/CursorCodeIcon.svelte';
  import GhosttyIcon from '$lib/components/shared/icons/GhosttyIcon.svelte';
  import JetBrainsIcon from '$lib/components/shared/icons/JetBrainsIcon.svelte';
  import TerminalIcon from '$lib/components/shared/icons/TerminalIcon.svelte';
  import VSCodeIcon from '$lib/components/shared/icons/VSCodeIcon.svelte';
  import WarpIcon from '$lib/components/shared/icons/WarpIcon.svelte';
  import XcodeIcon from '$lib/components/shared/icons/XcodeIcon.svelte';
  import { invoke } from '$lib/electron-bridge';
  import { fetchEditors } from '$lib/store/slices/external-editors/external-editors-slice';
  import { selectInstalledEditorsFiltered } from '$lib/store/slices/external-editors/external-editors-selectors';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { createLogger } from '$lib/utils/client-logger';
  import { isAbsolutePath, toNativePath, isWindowsPlatform } from '$lib/utils/path-utils';
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import {
    faBoxArchive,
    faBoxOpen,
    faCode,
    faFile,
    faFolder,
    faSpinner,
    faTerminal,
    faTrash,
    faUpRightFromSquare,
  } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { toast } from 'svelte-sonner';
  import Button from './button/button.svelte';

  /** Icon mapping from editor ID to Svelte component */
  const EDITOR_ICONS: Record<string, typeof VSCodeIcon> = {
    vscode: VSCodeIcon,
    cursor: CursorCodeIcon,
    jetbrains: JetBrainsIcon,
    xcode: XcodeIcon,
    warp: WarpIcon,
    ghostty: GhosttyIcon,
    terminal: TerminalIcon,
  };

  interface Props {
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

  const dispatch = getDispatch();
  const installedEditors$ = selectInstalledEditorsFiltered();

  let resolvedPath: string = $state('');
  let resolvedFolderPath: string = $state('');
  let isDeletingFile = $state(false);

  // Fetch installed editors when component mounts
  onMount(() => {
    dispatch(fetchEditors());
  });

  // Get installed editors for dynamic menu
  const installedEditors = $derived($installedEditors$);

  // Resolve the absolute path
  $effect(() => {
    if (filePath && workspaceId) {
      // Check if workspaceFolderPath is a special marker for workspace root
      if (workspaceFolderPath === '__WORKSPACE_ROOT__') {
        // For notes, resolve the workspace root path via IPC
        invoke<any>('workspace:get-root', { workspaceId })
          .then((rootPath) => {
            if (rootPath) {
              const normalizedRoot = rootPath.replace(/\\/g, '/');
              if (isAbsolutePath(filePath)) {
                resolvedPath = filePath.replace(/\\/g, '/');
              } else {
                resolvedPath = `${normalizedRoot}/${filePath}`.replace(/\/+/g, '/');
              }
              resolvedFolderPath = normalizedRoot;
              logger.info('[WorkspaceActionsMenu] Resolved note path:', {
                filePath,
                rootPath,
                resolvedPath,
              });
            } else {
              resolvedPath = filePath;
              resolvedFolderPath = '';
              logger.warn('[WorkspaceActionsMenu] No workspace root found');
            }
          })
          .catch((error) => {
            resolvedPath = filePath;
            resolvedFolderPath = '';
            logger.error('[WorkspaceActionsMenu] Failed to get workspace root:', error);
          });
      } else {
        // For code files, use the provided path or fall back to repository/worktree path
        invoke<any>('workspace:get', { id: workspaceId })
          .then((result) => {
            // Check if result exists and has valid data (not archived/deleted)
            if (result && result.success && result.data) {
              const workspace = result.data;
              const workspacePath =
                workspaceFolderPath || workspace.worktreePath || workspace.repositoryPath;

              if (workspacePath) {
                const normalizedWorkspacePath = workspacePath.replace(/\\/g, '/');
                if (isAbsolutePath(filePath)) {
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
      }
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
    }
  }

  async function openInXcode() {
    if (!resolvedPath) {
      logger.warn('[WorkspaceActionsMenu] No resolved path for Xcode');
      return;
    }
    try {
      // Fetch changed files to help find the right Xcode project in monorepos
      let changedFiles: string[] = [];
      if (workspaceId && resolvedFolderPath) {
        try {
          const statusResult = await invoke<{
            success: boolean;
            data?: { files: Array<{ path: string }> };
          }>('git:status', { workspaceId });

          if (statusResult?.success && statusResult.data?.files) {
            changedFiles = statusResult.data.files.map((f) => f.path);
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
        // User cancelled or error - don't log as error if cancelled
        if (result?.error !== 'No application selected') {
          logger.error('Failed to open with other app:', result?.error);
        }
        return;
      }

      onClose?.();
    } catch (error) {
      logger.error('Failed to open with other app:', error);
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

        const toastId = toast.warning(`Deleted "${fileName}"`, {
          duration: 15000,
          action: {
            label: 'Undo',
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
                toast.error('Failed to restore file');
              }
            },
          },
        });
      } else {
        toast.error(`Failed to delete file: ${result?.error || 'Unknown error'}`);
      }
    } catch (err) {
      logger.error('[WorkspaceActionsMenu] Error deleting file', err);
      toast.error('Failed to delete file');
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
</script>

<div class="w-full overflow-hidden">
  {#if showFileActions}
    <!-- Open Actions - dynamically rendered based on installed editors -->
    <div class="space-y-0.5">
      {#each installedEditors as editor (editor.id)}
        {@const IconComponent = EDITOR_ICONS[editor.id]}
        <Button
          variant="ghost"
          onclick={() => openInEditor(editor)}
          class="w-full min-w-0 justify-start"
          size="sm"
        >
          {#if editor.iconBase64}
            <!-- Use dynamic icon extracted from app bundle -->
            <img
              src="data:image/png;base64,{editor.iconBase64}"
              alt={editor.name}
              class="w-4 h-4 mr-1.5"
            />
          {:else if IconComponent}
            <IconComponent size={12} class="mr-1.5" />
          {:else if editor.category === 'terminal'}
            <Fa icon={faTerminal} size="12" class="mr-1.5 opacity-50" />
          {:else if editor.category === 'finder'}
            <Fa icon={faFolder} size="12" class="mr-1.5 opacity-50" />
          {:else}
            <Fa icon={faCode} size="12" class="mr-1.5 opacity-50" />
          {/if}
          <span class="truncate" title="Open in {editor.name}">Open in {editor.name}</span>
        </Button>
      {/each}

      <!-- Other... option to pick any app -->
      <Button
        variant="ghost"
        onclick={openWithOther}
        class="w-full min-w-0 justify-start text-subtle"
        size="sm"
      >
        <Fa icon={faUpRightFromSquare} size="12" class="ml-1.25 mr-2 opacity-50" />
        <span>Choose app</span>
      </Button>
    </div>

    <div class="my-1 h-px bg-border"></div>

    <!-- Copy Actions -->
    <div class="space-y-0.5">
      <Button
        variant="ghost"
        onclick={copyAbsolutePath}
        class="pl-3.75! gap-2.25! w-full min-w-0 justify-start"
        size="sm"
      >
        <div class="text-xs font-black font-mono mr-1 w-3 opacity-50">
          {isWindowsPlatform() ? '\\' : '/'}
        </div>
        <span>Copy Absolute Path</span>
      </Button>

      {#if !isWorkspaceRoot}
        <Button
          variant="ghost"
          onclick={copyWorkspacePath}
          class="pl-3.75! gap-2.25! w-full min-w-0 justify-start"
          size="sm"
        >
          <div class="text-xs font-black font-mono mr-1 w-3 opacity-50">./</div>
          <!-- <Fa icon={faCopy} size="12" class="mr-1.5" />  -->
          <span>Copy Relative Path</span>
        </Button>
      {/if}

      {#if showFileNameCopy && !isDirectory}
        <Button
          variant="ghost"
          onclick={copyFileName}
          class="pl-3.75! gap-2.25! w-full min-w-0 justify-start"
          size="sm"
        >
          <Fa icon={faFile} size="12" class="ml-1 mr-1.5 opacity-50" />
          <span>Copy File Name</span>
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
        onclick={() => {
          action.onClick();
          onClose?.();
        }}
        class="pl-3.75! gap-2.25! w-full min-w-0 justify-start {action.variant === 'destructive'
          ? 'hover:bg-destructive hover:text-destructive-foreground'
          : ''}"
        size="sm"
      >
        {#if action.iconSnippet}
          {@render action.iconSnippet()}
        {:else if action.icon}
          <Fa icon={action.icon} size="12" class="mr-1.5 opacity-50" />
        {/if}
        <span class="truncate" title={action.label}>{action.label}</span>
      </Button>
    {/each}
  {/if}

  <!-- Archive Action -->
  {#if showArchiveOption && (onArchive || onUnarchive)}
    <!-- <div class="my-1 h-px bg-border"></div> -->

    <Button
      variant="ghost"
      onclick={handleArchive}
      class="pl-3.75! gap-2.25! w-full min-w-0 justify-start"
      size="sm"
    >
      <Fa icon={isArchived ? faBoxOpen : faBoxArchive} size="12" class="mr-1.5 opacity-50" />
      <span>{isArchived ? 'Unarchive Space' : 'Archive Space'}</span>
    </Button>
  {/if}

  <!-- Delete Action -->
  {#if showDeleteOption && onDelete}
    <Button
      variant="ghost"
      onclick={handleDelete}
      class="pl-3.75! gap-2.25! w-full min-w-0 justify-start hover:bg-destructive hover:text-destructive-foreground"
      size="sm"
    >
      <Fa icon={faTrash} size="12" class="mr-1.5 opacity-50" />
      <span>Delete Space</span>
    </Button>
  {/if}

  <!-- Delete File Action -->
  {#if showDeleteFileOption && !isDirectory}
    <div class="my-1 h-px bg-border"></div>
    <Button
      variant="ghost"
      onclick={handleDeleteFile}
      disabled={isDeletingFile}
      class="pl-3.75! gap-2.25! w-full min-w-0 justify-start hover:bg-destructive hover:text-destructive-foreground"
      size="sm"
    >
      {#if isDeletingFile}
        <Fa icon={faSpinner} size="12" class="mr-1.5 opacity-50 animate-spin" />
      {:else}
        <Fa icon={faTrash} size="12" class="mr-1.5 opacity-50" />
      {/if}
      <span>Delete File</span>
    </Button>
  {/if}
</div>
