<script lang="ts">
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
  import type { FileExplorerTreeNode } from '$store/renderer/slices/file-explorer/file-explorer-types';
  import { filterFileExplorerChildPaths } from './file-explorer-sidebar-utils';

  import {
    initializeFileExplorer,
    toggleDirectoryRequested,
    refreshFileExplorer,
  } from '$store/renderer/slices/file-explorer/file-explorer-slice';
  import {
    selectFileExplorerRootNode,
    selectFileExplorerIsLoading,
    selectFileExplorerError,
    selectFileExplorerFileCount,
    selectFileExplorerNodeMap,
    selectEffectiveFileExplorerWorkspacePath,
    selectIsPathExpanded,
    selectIsPathLoading,
    selectShouldInitializeFileExplorerForWorkspace,
  } from '$store/renderer/slices/file-explorer/file-explorer-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    workspaceId: string;
    onFileSelect?: (path: string) => void;
    selectedFile?: string;
  }

  let { workspaceId, onFileSelect, selectedFile = $bindable('') }: Props = $props();

  // Capture dispatch at component init time (store.dispatch reads the configured app store,
  // which is only valid during component initialization).

  const wsIdStore = writable(workspaceId);
  const fileExplorerWorkspacePath$ = selectEffectiveFileExplorerWorkspacePath(wsIdStore);
  const rootNode$ = selectFileExplorerRootNode(wsIdStore);
  const feIsLoading$ = selectFileExplorerIsLoading(wsIdStore);
  const feError$ = selectFileExplorerError(wsIdStore);
  const fileCount$ = selectFileExplorerFileCount(wsIdStore);
  const nodeMap$ = selectFileExplorerNodeMap(wsIdStore);
  const shouldInitializeFileExplorer$ = selectShouldInitializeFileExplorerForWorkspace(wsIdStore);

  // Effective workspace id used for dispatches.
  const effectiveWsId = $derived(workspaceId);

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
  function selectFile(node: FileExplorerTreeNode) {
    if (node.type === 'file') {
      selectedFile = node.path;
      onFileSelect?.(node.path);
    } else {
      appStore.dispatch(toggleDirectoryRequested(effectiveWsId, node.path));
    }
  }

  // Keep the reactive selector arg in sync with the prop.
  $effect(() => {
    wsIdStore.set(workspaceId);
  });

  // React to workspace path changes
  $effect(() => {
    const workspacePath = $fileExplorerWorkspacePath$;
    if (workspacePath && $shouldInitializeFileExplorer$) {
      appStore.dispatch(
        initializeFileExplorer(effectiveWsId, {
          workspacePath,
          workspaceId,
        }),
      );
    }
  });
</script>

<Sidebar.Root collapsible="icon">
  <Sidebar.Header>
    <div class="flex items-center gap-2 px-2">
      <Input
        bind:value={searchQuery}
        placeholder={m.fileExplorer_sidebar_search_placeholder()}
        class="h-8"
      />
      <Button
        size="icon"
        variant="ghost"
        onclick={() => appStore.dispatch(refreshFileExplorer(effectiveWsId))}
        title={m.fileExplorer_sidebar_refresh_tooltip()}
      >
        <Fa icon={faArrowsRotate} size="1x" class="w-4 h-4" />
      </Button>
    </div>
  </Sidebar.Header>

  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.GroupLabel>{m.fileExplorer_sidebar_files_label()}</Sidebar.GroupLabel>
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
              {#snippet FileTreeItem(node: FileExplorerTreeNode, depth: number)}
                {@const wsId = effectiveWsId}
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
                        {:else if node.children.length > 0}
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
                      class="w-4 h-4 {node.type === 'directory' ? 'text-blue-500' : 'text-subtle'}"
                    />
                    <span class="truncate">{node.name}</span>
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>

                {#if nodeExpanded}
                  {#each filterFileExplorerChildPaths(node.children, searchQuery, $nodeMap$) as childPath (childPath)}
                    {@const child = $nodeMap$[childPath]}
                    {#if child}
                      {@render FileTreeItem(child, depth + 1)}
                    {/if}
                  {/each}
                {/if}
              {/snippet}

              {#each filterFileExplorerChildPaths($rootNode$.children, searchQuery, $nodeMap$) as childPath (childPath)}
                {@const node = $nodeMap$[childPath]}
                {#if node}
                  {@render FileTreeItem(node, 0)}
                {/if}
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
        {m.fileExplorer_sidebar_fileCount_many({ count: $fileCount$ })}
      {/if}
    </div>
  </Sidebar.Footer>
</Sidebar.Root>
