<script lang="ts">
  import FileTreeView from '$lib/components/file-explorer/file-tree-view.svelte';
  import MessageDialog from '$lib/components/modals/MessageDialog.svelte';
  import { cn } from '$lib/utils';
  import { invoke } from '$lib/electron-bridge';
  import { createLogger } from '$lib/utils/client-logger';
  import {
    FILE_CONFLICT_BUTTONS,
    FILE_CONFLICT_TITLE,
    fileConflictMessage,
    promptFileConflict,
    type WebConflictPromptRequest,
  } from './file-conflict-prompt';
  import { toast } from 'svelte-sonner';
  import { gitCache } from '$features/git/git-cache';
  import { loadGitStatus } from '$store/renderer/slices/git/git-slice';
  import { refreshFileExplorer } from '$store/renderer/slices/file-explorer/file-explorer-slice';
  import { selectEffectiveFileExplorerWorkspacePath } from '$store/renderer/slices/file-explorer/file-explorer-selectors';

  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('FilesPanel');

  // Helper to check if a file exists at the given path
  async function checkFileExists(filePath: string): Promise<boolean> {
    try {
      const response = (await invoke('file:exists', { path: filePath })) as {
        success: boolean;
        exists?: boolean;
        data?: boolean;
      };
      return response.success && (response.exists ?? response.data ?? false);
    } catch {
      return false;
    }
  }

  // Helper to generate a unique filename if the file already exists
  // e.g., "file.txt" -> "file (1).txt", "file (1).txt" -> "file (2).txt"
  async function generateUniqueFilename(folder: string, originalName: string): Promise<string> {
    const lastDotIndex = originalName.lastIndexOf('.');
    const hasExtension = lastDotIndex > 0;
    const baseName = hasExtension ? originalName.slice(0, lastDotIndex) : originalName;
    const extension = hasExtension ? originalName.slice(lastDotIndex) : '';

    let counter = 1;
    let newName = `${baseName} (${counter})${extension}`;
    let newPath = `${folder}/${newName}`;

    while (await checkFileExists(newPath)) {
      counter++;
      newName = `${baseName} (${counter})${extension}`;
      newPath = `${folder}/${newName}`;

      // Safety limit to prevent infinite loops
      if (counter > 1000) {
        throw new Error('Could not generate unique filename');
      }
    }

    return newName;
  }

  // Pending web drop-conflict prompt; non-null renders the in-app MessageDialog.
  // On electron promptFileConflict uses the native dialog and never sets this.
  let webConflictPrompt: WebConflictPromptRequest | null = $state(null);

  function resolveWebConflictPrompt(buttonIndex: number) {
    const request = webConflictPrompt;
    webConflictPrompt = null;
    request?.resolve(buttonIndex);
  }

  interface Props {
    workspaceId: string;
    selectedFile?: string | null;
    onOpenFile?: (filePath: string) => void;
    onCreateFile?: (folderPath: string, fileName?: string) => void | Promise<void>;
    onFileRenamed?: (oldPath: string, newPath: string) => void;
    onSelectAgent?: (agentId: string) => void;
    showOnlyChanged?: boolean;
    searchQuery?: string;
    class?: string;
  }

  let {
    workspaceId,
    selectedFile = null,
    onOpenFile,
    onCreateFile,
    onFileRenamed,
    onSelectAgent,
    showOnlyChanged = false,
    searchQuery = '',
    class: className,
  }: Props = $props();

  const effectiveWsId = $derived(workspaceId);
  const fileExplorerWorkspacePath = selectEffectiveFileExplorerWorkspacePath(workspaceId);

  // Handle file rename via IPC
  async function handleRenameFile(oldPath: string, newPath: string) {
    try {
      const response = (await invoke('file:move', { oldPath, newPath })) as {
        success: boolean;
        error?: string;
      };
      if (response.success) {
        logger.info('File renamed successfully', { oldPath, newPath });
        const fileName = newPath.split('/').pop() || newPath;
        toast.success(`Renamed to "${fileName}"`);
        // Notify parent so it can update any open panels with this file
        logger.info('Calling onFileRenamed callback', {
          hasCallback: !!onFileRenamed,
          oldPath,
          newPath,
        });
        onFileRenamed?.(oldPath, newPath);
        // Refresh the file tree to show the new name immediately
        appStore.dispatch(refreshFileExplorer(effectiveWsId));
      } else {
        throw new Error(response.error || 'Failed to rename file');
      }
    } catch (error) {
      logger.error('Failed to rename file', error as Error, { oldPath, newPath });
      toast.error('Failed to rename file', {
        description: (error as Error).message,
      });
    }
  }

  // Handle external files dropped onto the file tree
  async function handleExternalFilesDrop(files: File[], targetPath: string | null) {
    const workspacePath = selectEffectiveFileExplorerWorkspacePath.select(
      appStore.state,
      workspaceId,
    );
    if (!workspacePath || files.length === 0) return;

    // Use the drop target path if provided, otherwise fall back to workspace root
    const destinationFolder = targetPath || workspacePath;

    logger.info('Handling external files drop', {
      fileCount: files.length,
      fileNames: files.map((f) => f.name),
      targetPath,
      destinationFolder,
    });

    let successCount = 0;
    let failedCount = 0;
    let folderCount = 0;
    const failedFiles: string[] = [];

    // Show progress toast for multiple items or potential folders
    const hasMultipleItems = files.length > 1;
    let progressToastId: string | number | undefined;

    if (hasMultipleItems) {
      progressToastId = toast.loading(`Copying ${files.length} items...`);
    }

    // Track skipped files separately from failed files
    let skippedCount = 0;

    // Copy each file/folder to the destination folder
    for (const file of files) {
      try {
        // Get the source path from the File object
        // In Electron, dropped files have a 'path' property with the full filesystem path
        const sourcePath = (file as File & { path?: string }).path;

        // Check if this is a folder without a path (dropped from Finder)
        // Folders have size 0 and no type, but we can't read their contents via File API
        const isLikelyFolder = !sourcePath && file.size === 0 && file.type === '';
        if (isLikelyFolder) {
          logger.warn('Folder dropped from Finder cannot be copied (browser File API limitation)', {
            fileName: file.name,
          });
          failedCount++;
          failedFiles.push(`${file.name} (folders not supported)`);
          continue;
        }

        let destinationPath = `${destinationFolder}/${file.name}`;
        let finalFileName = file.name;

        // Check if file already exists and handle conflict
        const fileExists = await checkFileExists(destinationPath);
        if (fileExists) {
          logger.info('File already exists, prompting for resolution', {
            fileName: file.name,
            destinationPath,
          });

          const resolution = await promptFileConflict(
            file.name,
            (request) => (webConflictPrompt = request),
          );

          if (resolution === 'skip') {
            logger.info('User chose to skip existing file', { fileName: file.name });
            skippedCount++;
            continue;
          }

          if (resolution === 'rename') {
            // Generate a unique filename
            finalFileName = await generateUniqueFilename(destinationFolder, file.name);
            destinationPath = `${destinationFolder}/${finalFileName}`;
            logger.info('Renaming file to avoid conflict', {
              originalName: file.name,
              newName: finalFileName,
            });
          }
          // If 'overwrite', we keep the original destinationPath and proceed
        }

        // Show progress for single folder drops (they can take time for large directories)
        const isSingleItem = files.length === 1;
        if (isSingleItem) {
          progressToastId = toast.loading(`Copying "${finalFileName}"...`);
        }

        let response: { success: boolean; error?: string; data?: { isDirectory?: boolean } };

        if (sourcePath) {
          // Files with path property (from Electron or internal sources) - use file:copy
          response = (await invoke('file:copy', {
            sourcePath,
            destinationPath,
          })) as { success: boolean; error?: string; data?: { isDirectory?: boolean } };
        } else {
          // Files without path property (from Finder/OS file manager) - read content and use file:write
          logger.info('Reading file content via File API (no path property)', {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
          });

          // Read file content as ArrayBuffer and convert to base64
          const arrayBuffer = await file.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
          }
          const base64Content = btoa(binary);

          response = (await invoke('file:write', {
            path: destinationPath,
            content: base64Content,
            encoding: 'base64',
          })) as { success: boolean; error?: string; data?: { isDirectory?: boolean } };
        }

        if (response.success) {
          successCount++;
          if (response.data?.isDirectory) {
            folderCount++;
          }
          logger.info('Item copied successfully', {
            sourcePath: sourcePath || '(read via File API)',
            destinationPath,
            isDirectory: response.data?.isDirectory,
          });
        } else {
          failedCount++;
          failedFiles.push(file.name);
          logger.error('Failed to copy item', new Error(response.error || 'Unknown error'), {
            sourcePath: sourcePath || '(read via File API)',
            destinationPath,
          });
        }
      } catch (error) {
        failedCount++;
        failedFiles.push(file.name);
        logger.error('Error copying item', error as Error, { fileName: file.name });
      }
    }

    // Dismiss progress toast
    if (progressToastId !== undefined) {
      toast.dismiss(progressToastId);
    }

    // Show result toast notification
    if (successCount > 0 && failedCount === 0 && skippedCount === 0) {
      const message = formatSuccessMessage(successCount, folderCount, files);
      toast.success(message);
    } else if (successCount > 0 && failedCount === 0 && skippedCount > 0) {
      const message = formatSuccessMessage(successCount, folderCount, files);
      toast.success(message, {
        description: `${skippedCount} ${skippedCount === 1 ? 'file' : 'files'} skipped`,
      });
    } else if (successCount > 0 && failedCount > 0) {
      let description = `Failed: ${failedFiles.join(', ')}`;
      if (skippedCount > 0) {
        description += ` (${skippedCount} skipped)`;
      }
      toast.warning(`Added ${successCount} items, ${failedCount} failed`, {
        description,
      });
    } else if (failedCount > 0) {
      toast.error(`Failed to add ${failedCount === 1 ? 'item' : 'items'}`, {
        description: failedFiles.join(', '),
      });
    } else if (skippedCount > 0) {
      toast.info(`${skippedCount} ${skippedCount === 1 ? 'file was' : 'files were'} skipped`);
    }

    // Refresh the file tree to show newly added files/folders
    if (successCount > 0) {
      appStore.dispatch(refreshFileExplorer(effectiveWsId));

      // Refresh git status to show new files in Changes panel
      if (workspaceId) {
        gitCache.invalidate(`git-status-${workspaceId}`);
        appStore.dispatch(loadGitStatus(workspaceId, true));
      }
    }
  }

  // Helper to format success message based on what was added
  function formatSuccessMessage(successCount: number, folderCount: number, files: File[]): string {
    if (successCount === 1) {
      const itemType = folderCount === 1 ? 'folder' : 'file';
      return `Added ${itemType} "${files[0].name}"`;
    }

    const fileCount = successCount - folderCount;
    const parts: string[] = [];

    if (folderCount > 0) {
      parts.push(`${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`);
    }
    if (fileCount > 0) {
      parts.push(`${fileCount} ${fileCount === 1 ? 'file' : 'files'}`);
    }

    return `Added ${parts.join(' and ')}`;
  }

  let fileTreeRef: FileTreeView | null = $state(null);

  // Export expand/collapse all functions for parent components
  export async function expandAll() {
    await fileTreeRef?.expandAll();
  }

  export function collapseAll() {
    fileTreeRef?.collapseAll();
  }

  // Export getter to check if any directories are expanded
  export function getHasExpandedDirectories(): boolean {
    return fileTreeRef?.getHasExpandedDirectories() ?? false;
  }

  // Export startCreatingFile for parent components to trigger inline file creation
  export function startCreatingFile(dirPath?: string) {
    fileTreeRef?.startCreatingFile(dirPath);
  }

  // Export search keyboard navigation for parent components
  export function handleSearchKeyDown(e: KeyboardEvent) {
    fileTreeRef?.handleSearchKeyDown(e);
  }
</script>

<div class={cn('pb-3', className)}>
  {#if $fileExplorerWorkspacePath}
    <div class="overflow-y-auto">
      <FileTreeView
        bind:this={fileTreeRef}
        {workspaceId}
        onFileSelect={onOpenFile}
        {onCreateFile}
        onRenameFile={handleRenameFile}
        {onSelectAgent}
        onExternalFilesDrop={handleExternalFilesDrop}
        selectedFile={selectedFile ?? ''}
        {showOnlyChanged}
        {searchQuery}
      />
    </div>
  {:else}
    <div class="px-4 py-3 text-sm text-subtle">No space folder linked</div>
  {/if}
</div>

{#if webConflictPrompt}
  <MessageDialog
    open={true}
    title={FILE_CONFLICT_TITLE}
    message={fileConflictMessage(webConflictPrompt.fileName)}
    type="warning"
    buttons={[...FILE_CONFLICT_BUTTONS]}
    onSelect={resolveWebConflictPrompt}
  />
{/if}
