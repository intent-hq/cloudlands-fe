<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import {
  faArrowsRotate,
  faFolder,
  faFolderOpen,
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


  import {
  initializeFileExplorer,
  setWorkspacePathRequested,
  toggleDirectoryRequested,
  refreshFileExplorer,
} from '$lib/store/slices/file-explorer/file-explorer-slice';
  import {
  selectFileExplorerRootNode,
  selectFileExplorerIsLoading,
  selectFileExplorerError,
  selectFileExplorerFileCount,
  selectIsPathExpanded,
  selectIsPathLoading,
} from '$lib/store/slices/file-explorer/file-explorer-selectors';
  import { store as appStore } from '$lib/store/store';

  interface Props {
    workspacePath: string;
    workspaceId?: string;
    onFileSelect?: (path: string) => void;
    selectedFile?: string;
  }

  let { workspacePath, workspaceId, onFileSelect, selectedFile = $bindable('') }: Props = $props();

  // Capture dispatch at component init time (store.dispatch reads the configured app store,
  // which is only valid during component initialization).

  const wsIdStore = writable(workspaceId || workspacePath || '');
  const rootNode$ = selectFileExplorerRootNode(wsIdStore);
  const feIsLoading$ = selectFileExplorerIsLoading(wsIdStore);
  const feError$ = selectFileExplorerError(wsIdStore);
  const fileCount$ = selectFileExplorerFileCount(wsIdStore);

  // Effective workspace id used for dispatches.
  const effectiveWsId = $derived(workspaceId || workspacePath || '');

  let searchQuery = $state('');

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
      appStore.dispatch(toggleDirectoryRequested(effectiveWsId, node.path));
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

  onMount(() => {
    // Dispatch initialization — the file-explorer saga owns IPC listeners
    // (file:changed, workspace-changes, file-tracking:changes-updated) and
    // will refresh state when those events fire for the active workspace.
    appStore.dispatch(
      initializeFileExplorer(effectiveWsId, { workspacePath, workspaceId }),
    );
  });

  // Keep the reactive selector arg in sync with the prop.
  $effect(() => {
    wsIdStore.set(workspaceId || workspacePath || '');
  });

  // React to workspace path changes
  $effect(() => {
    if (workspacePath) {
      appStore.dispatch(setWorkspacePathRequested(effectiveWsId, workspacePath));
    }
  });
</script>

<Sidebar.Root collapsible="icon">
  <Sidebar.Header>
    <div class="flex items-center gap-2 px-2">
      <Input bind:value={searchQuery} placeholder="Search files..." class="h-8" />
      <Button
        size="icon"
        variant="ghost"
        onclick={() => appStore.dispatch(refreshFileExplorer(effectiveWsId))}
        title="Refresh"
      >
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
            {#if $feIsLoading$}
              <div class="flex items-center justify-center py-8">
                <Fa icon={faSpinner} size="lg" class="w-6 h-6 animate-spin text-subtle" />
              </div>
            {:else if $feError$}
              <div class="px-4 py-2 text-sm text-destructive-foreground">
                {$feError$}
              </div>
            {:else if $rootNode$}
              {#snippet FileTreeItem(node: FileNode, depth: number)}
                {@const wsId = workspaceId || workspacePath || ''}
                {@const nodeExpanded = selectIsPathExpanded.select(appStore.state, wsId, node.path)}
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
                        {#if selectIsPathLoading.select(appStore.state, wsId, node.path)}
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

              {#each filterNodes($rootNode$.children || [], searchQuery) as node (node.path)}
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
      {#if $fileCount$ > 0}
        {$fileCount$} files
      {/if}
    </div>
  </Sidebar.Footer>
</Sidebar.Root>
