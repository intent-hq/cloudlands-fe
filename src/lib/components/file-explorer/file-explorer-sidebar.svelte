<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import { invoke, listenSync } from '$lib/electron-bridge';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import {
    faSearch,
    faArrowsRotate,
    faFolder,
    faFolderOpen,
    faFile,
    faFileAlt,
    faFileCode,
    faImage,
    faArchive,
    faCog,
    faChevronRight,
    faChevronDown,
    faSpinner,
  } from '@fortawesome/free-solid-svg-icons';
  import type { FileNode } from '$shared/types';
  import { createFileExplorerStore } from './file-explorer-store.svelte';

  interface Props {
    workspacePath: string;
    workspaceId?: string;
    onFileSelect?: (path: string) => void;
    selectedFile?: string;
  }

  let { workspacePath, workspaceId, onFileSelect, selectedFile = $bindable('') }: Props = $props();

  const store = createFileExplorerStore(workspacePath, workspaceId);
  let searchQuery = $state('');
  let fileWatcher: any = null;
  let workspaceChangesWatcher: any = null;

  // Get file icon based on extension
  function getFileIcon(fileName: string) {
    const ext = fileName.split('.').pop()?.toLowerCase();

    const codeExtensions = [
      'js',
      'ts',
      'jsx',
      'tsx',
      'svelte',
      'vue',
      'py',
      'rs',
      'go',
      'java',
      'cpp',
      'c',
      'h',
      'hpp',
    ];
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'];
    const archiveExtensions = ['zip', 'tar', 'gz', 'rar', '7z'];
    const configExtensions = ['json', 'yaml', 'yml', 'toml', 'ini', 'env'];

    if (codeExtensions.includes(ext || '')) return faFileCode;
    if (imageExtensions.includes(ext || '')) return faImage;
    if (archiveExtensions.includes(ext || '')) return faArchive;
    if (configExtensions.includes(ext || '')) return faCog;

    return faFileAlt;
  }

  // Handle file selection
  function selectFile(node: FileNode) {
    if (node.type === 'file') {
      selectedFile = node.path;
      onFileSelect?.(node.path);
    } else {
      store.toggleDirectory(node);
    }
  }

  // Filter nodes by search query
  function filterNodes(nodes: FileNode[], query: string): FileNode[] {
    if (!query) return nodes;

    const lowerQuery = query.toLowerCase();
    return nodes.filter((node) => {
      const matches = node.name.toLowerCase().includes(lowerQuery);
      if (matches) return true;

      // Also check children for directories
      if (node.children) {
        const childMatches = filterNodes(node.children, query);
        return childMatches.length > 0;
      }

      return false;
    });
  }

  // Watch for file changes
  function setupFileWatcher() {
    fileWatcher = listenSync('file:changed', (event: any) => {
      // Reload the tree when files change
      store.refresh();
    });
  }

  // Watch for workspace changes (handles file saves and other changes)
  function setupWorkspaceChangesWatcher() {
    workspaceChangesWatcher = listenSync('workspace-changes', (event: any) => {
      // Extract workspaceId from event (handle both wrapped and unwrapped formats)
      const eventWorkspaceId = event?.payload?.workspaceId || event?.workspaceId;

      // Check if the event is for our workspace
      // Only refresh if we have a workspace ID and it matches
      if (eventWorkspaceId && eventWorkspaceId === workspaceId) {
        // Refresh the file tree when workspace changes are detected
        store.refresh();
      }
      // Note: We don't refresh if there's no workspace ID to avoid unnecessary updates
    });
  }

  onMount(async () => {
    await store.initialize();
    setupFileWatcher();
    setupWorkspaceChangesWatcher();
  });

  onDestroy(() => {
    if (fileWatcher) {
      fileWatcher();
    }
    if (workspaceChangesWatcher) {
      workspaceChangesWatcher();
    }
  });

  // React to workspace path changes
  $effect(() => {
    if (workspacePath) {
      store.setWorkspacePath(workspacePath);
    }
  });
</script>

<Sidebar.Root collapsible="icon">
  <Sidebar.Header>
    <div class="flex items-center gap-2 px-2">
      <Input bind:value={searchQuery} placeholder="Search files..." class="h-8" />
      <Button size="icon" variant="ghost" onclick={() => store.refresh()} title="Refresh">
        <Fa icon={faArrowsRotate} size="1x" class="w-4 h-4" />
      </Button>
    </div>
  </Sidebar.Header>

  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.GroupLabel>Files</Sidebar.GroupLabel>
      <Sidebar.GroupContent>
        <ScrollArea class="h-[calc(100vh-8rem)]">
          <Sidebar.Menu>
            {#if store.isLoading}
              <div class="flex items-center justify-center py-8">
                <Fa icon={faSpinner} size="lg" class="w-6 h-6 animate-spin text-subtle" />
              </div>
            {:else if store.error}
              <div class="px-4 py-2 text-sm text-destructive-foreground">
                {store.error}
              </div>
            {:else if store.rootNode}
              {#snippet FileTreeItem(node: FileNode, depth: number)}
                {@const nodeExpanded = store.isExpanded(node.path)}
                {@const isIgnored = node.isGitignored === true}
                {@const Icon =
                  node.type === 'directory'
                    ? nodeExpanded
                      ? faFolderOpen
                      : faFolder
                    : getFileIcon(node.name) || faFileAlt}

                <Sidebar.MenuItem>
                  <Sidebar.MenuButton
                    class="w-full {isIgnored ? 'opacity-50' : ''}"
                    isActive={selectedFile === node.path}
                    onclick={() => selectFile(node)}
                    style={`padding-left: ${depth * 12 + 8}px`}
                  >
                    {#if node.type === 'directory'}
                      <span class="w-4 h-4 flex items-center justify-center mr-1">
                        {#if store.isPathLoading(node.path)}
                          <Fa icon={faSpinner} size="xs" class="w-3 h-3 animate-spin" />
                        {:else if node.children && node.children.length > 0}
                          <Fa
                            icon={nodeExpanded ? faChevronDown : faChevronRight}
                            size="xs"
                            class="w-3 h-3"
                          />
                        {/if}
                      </span>
                    {/if}

                    <Fa
                      icon={Icon}
                      size="1x"
                      class="w-4 h-4 {node.type === 'directory'
                        ? 'text-blue-500'
                        : 'text-subtle'}"
                    />
                    <span class="truncate">{node.name}</span>
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>

                {#if nodeExpanded && node.children}
                  {#each filterNodes(node.children, searchQuery) as child (child.path)}
                    {@render FileTreeItem(child, depth + 1)}
                  {/each}
                {/if}
              {/snippet}

              {#each filterNodes(store.rootNode.children || [], searchQuery) as node (node.path)}
                {@render FileTreeItem(node, 0)}
              {/each}
            {:else}
              <!-- <div class="px-4 py-2 text-sm text-subtle">
                No files found
              </div> -->
            {/if}
          </Sidebar.Menu>
        </ScrollArea>
      </Sidebar.GroupContent>
    </Sidebar.Group>
  </Sidebar.Content>

  <Sidebar.Footer>
    <div class="px-2 py-1 text-xs text-subtle">
      {#if store.fileCount > 0}
        {store.fileCount} files
      {/if}
    </div>
  </Sidebar.Footer>
</Sidebar.Root>
