<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { invoke } from '$lib/electron-bridge';
  import FileExplorerSidebar from './file-explorer-sidebar.svelte';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import * as Breadcrumb from '$lib/components/ui/breadcrumb';
  import { Separator } from '$lib/components/ui/separator';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import { Button } from '$lib/components/ui/button';
  import { selectEffectiveFileExplorerWorkspacePath } from '$store/renderer/slices/file-explorer/file-explorer-selectors';
  import {
  faXmark,
  faFileAlt,
  faExclamationCircle,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
  import { createLogger } from '$lib/utils/client-logger';
  import { m } from '$shared/paraglide/messages.js';

  const logger = createLogger('FileExplorerLayout');

  interface Props {
    workspaceId?: string;
    initialFile?: string;
  }

  let { workspaceId = '', initialFile }: Props = $props();

  const workspaceIdStore = writable(workspaceId);
  const fileExplorerWorkspacePath = selectEffectiveFileExplorerWorkspacePath(workspaceIdStore);

  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  // State for open files
  let openFiles = $state<Map<string, { content: string; modified: boolean }>>(new Map());
  let selectedFile: string = $state(initialFile || '');
  let currentFileContent: string = $state('');
  let isLoading = $state(false);
  let error: string | null = $state(null);

  // Get breadcrumb parts from file path
  function getBreadcrumbParts(filePath: string): string[] {
    if (!filePath) return [];
    const relativePath = filePath.replace($fileExplorerWorkspacePath, '').replace(/^\//, '');
    return relativePath.split('/').filter(Boolean);
  }

  // Load file content
  async function loadFile(filePath: string) {
    if (openFiles.has(filePath)) {
      currentFileContent = openFiles.get(filePath)!.content;
      return;
    }

    isLoading = true;
    error = null;

    try {
      const result = (await invoke('file:open', { path: filePath })) as any;
      if (result?.success) {
        const fileData = { content: result.content, modified: false };
        openFiles.set(filePath, fileData);
        currentFileContent = result.content;
      } else {
        error = result?.error || m.fileExplorer_layout_loadFailed_error();
      }
    } catch (err) {
      logger.error('Failed to load file:', err);
      error = m.fileExplorer_layout_loadFailed_error();
    } finally {
      isLoading = false;
    }
  }

  // Save file
  async function saveFile(filePath: string) {
    const fileData = openFiles.get(filePath);
    if (!fileData || !fileData.modified) return;

    try {
      const result = (await invoke('file:save', { filePath, content: fileData.content })) as any;
      if (result?.success) {
        fileData.modified = false;
        openFiles.set(filePath, fileData);
      } else {
        error = result?.error || m.fileExplorer_layout_saveFailed_error();
      }
    } catch (err) {
      logger.error('Failed to save file:', err);
      error = m.fileExplorer_layout_saveFailed_error();
    }
  }

  // Close file
  function closeFile(filePath: string) {
    openFiles.delete(filePath);
    if (selectedFile === filePath) {
      const remainingFiles = Array.from(openFiles.keys());
      selectedFile = remainingFiles[remainingFiles.length - 1] || '';
      if (selectedFile) {
        currentFileContent = openFiles.get(selectedFile)!.content;
      }
    }
  }

  // Handle file selection
  async function handleFileSelect(filePath: string) {
    selectedFile = filePath;
    await loadFile(filePath);
  }

  // Handle content changes
  function handleContentChange(newContent: string) {
    if (selectedFile && openFiles.has(selectedFile)) {
      const fileData = openFiles.get(selectedFile)!;
      fileData.content = newContent;
      fileData.modified = true;
      openFiles.set(selectedFile, fileData);
      currentFileContent = newContent;
    }
  }

  // Watch for editor changes
  $effect(() => {
    if (currentFileContent !== undefined && selectedFile) {
      handleContentChange(currentFileContent);
    }
  });

  // Get file language from extension
  function getFileLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      svelte: 'javascript',
      vue: 'javascript',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      cpp: 'cpp',
      c: 'cpp',
      h: 'cpp',
      hpp: 'cpp',
      cs: 'csharp',
      rb: 'ruby',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      r: 'r',
      m: 'objectivec',
      mm: 'objectivec',
      sql: 'sql',
      html: 'html',
      css: 'css',
      scss: 'css',
      sass: 'css',
      less: 'css',
      json: 'json',
      xml: 'xml',
      yaml: 'yaml',
      yml: 'yaml',
      toml: 'toml',
      ini: 'ini',
      md: 'markdown',
      mdx: 'markdown',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      fish: 'shell',
      ps1: 'powershell',
      dockerfile: 'dockerfile',
      makefile: 'makefile',
    };
    return languageMap[ext || ''] || 'text';
  }

  // Keyboard shortcuts
  function handleKeydown(event: KeyboardEvent) {
    // Save file: Cmd/Ctrl + S
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      if (selectedFile) {
        saveFile(selectedFile);
      }
    }
    // Note: Cmd+W is handled by PanelLayout for closing panel tabs
    // This component no longer needs to handle it
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  // Load initial file if provided
  $effect(() => {
    if (initialFile) {
      handleFileSelect(initialFile);
    }
  });
</script>

<Sidebar.Provider>
  <FileExplorerSidebar
    {workspaceId}
    onFileSelect={handleFileSelect}
    bind:selectedFile
  />

  <Sidebar.Inset>
    <!-- Header with breadcrumb and tabs -->
    <header class="flex flex-col border-b">
      <!-- Breadcrumb -->
      <div class="flex h-12 items-center gap-2 px-4">
        <Sidebar.Trigger class="-ml-1" />
        <Separator orientation="vertical" class="h-4" />
        <Breadcrumb.Root>
          <Breadcrumb.List>
            {#each getBreadcrumbParts(selectedFile) as part, i (`crumb-${i}-${part}`)}
              {#if i !== getBreadcrumbParts(selectedFile).length - 1}
                <Breadcrumb.Item>
                  <Breadcrumb.Link href="#">{part}</Breadcrumb.Link>
                </Breadcrumb.Item>
                <Breadcrumb.Separator />
              {:else}
                <Breadcrumb.Item>
                  <Breadcrumb.Page>{part}</Breadcrumb.Page>
                </Breadcrumb.Item>
              {/if}
            {/each}
          </Breadcrumb.List>
        </Breadcrumb.Root>
      </div>

      <!-- Open files tabs -->
      {#if openFiles.size > 0}
        <div class="flex items-center gap-1 px-2 pb-2 overflow-x-auto">
          {#each Array.from(openFiles.entries()) as [filePath, fileData] (filePath)}
            {@const fileName = filePath.split('/').pop() || filePath}
            <Button
              variant={selectedFile === filePath ? 'secondary' : 'ghost'}
              size="sm"
              class="flex items-center gap-2 min-w-fit"
              onclick={() => handleFileSelect(filePath)}
            >
              <Fa icon={faFileAlt} size="xs" class="w-3 h-3" />
              <span class="text-xs">{fileName}</span>
              {#if fileData.modified}
                <span class="w-2 h-2 bg-blue-500 rounded-full"></span>
              {/if}
              <button
                class="ml-1 hover:bg-accent rounded p-0.5"
                onclick={(e) => {
                  e.stopPropagation();
                  closeFile(filePath);
                }}
              >
                <Fa icon={faXmark} size="xs" class="w-3 h-3" />
              </button>
            </Button>
          {/each}
        </div>
      {/if}
    </header>

    <!-- Main content area -->
    <div class="flex-1 overflow-hidden">
      {#if error}
        <div class="flex items-center justify-center h-full">
          <div class="flex flex-col items-center gap-4 text-center">
            <Fa icon={faExclamationCircle} size="2x" class="w-12 h-12 text-destructive-foreground" />
            <p class="text-sm text-subtle">{error}</p>
          </div>
        </div>
      {:else if isLoading}
        <div class="flex items-center justify-center h-full">
          <Fa icon={faSpinner} size="lg" class="w-8 h-8 animate-spin text-subtle" />
        </div>
      {:else if selectedFile}
        <CodeEditor
          bind:value={currentFileContent}
          language={getFileLanguage(selectedFile)}
          fileName={selectedFile}
          lineNumbers={true}
          highlightActiveLine={true}
        />
      {:else}
        <div class="flex items-center justify-center h-full">
          <div class="text-center">
            <Fa icon={faFileAlt} size="2x" class="w-12 h-12 mx-auto mb-4 text-subtle" />
            <p class="text-sm text-subtle">
              {m.fileExplorer_layout_selectFile_label()}
            </p>
          </div>
        </div>
      {/if}
    </div>
  </Sidebar.Inset>
</Sidebar.Provider>
