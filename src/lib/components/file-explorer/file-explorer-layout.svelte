<script lang="ts">
  import { editableText } from '$features/file/utils/file-content';
  import { onMount, untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import FileExplorerSidebar from './file-explorer-sidebar.svelte';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import * as Breadcrumb from '$lib/components/ui/breadcrumb';
  import { Separator } from '$lib/components/ui/separator';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { selectEffectiveFileExplorerWorkspacePath } from '$store/renderer/slices/file-explorer/file-explorer-selectors';
  import { faXmark, faFileAlt, faExclamationCircle } from '@fortawesome/free-solid-svg-icons';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectAllFileContentEntries,
    selectFileContentEntry,
  } from '$store/renderer/slices/files/files-selectors';
  import {
    loadFileContentRequested,
    saveFileContentRequested,
    updateFileContent,
  } from '$store/renderer/slices/files/files-slice';
  import { m } from '$shared/paraglide/messages.js';
  import { stripWorkspacePrefix } from '$lib/utils/file-utils';
  import { downloadWorkspaceFile } from '$features/file/services/download-workspace-file';
  import { notify } from '$lib/components/patterns/notify';

  interface Props {
    workspaceId?: string;
    initialFile?: string;
  }

  let { workspaceId = '', initialFile }: Props = $props();

  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect below syncs later changes
  const workspaceIdStore = writable(workspaceId);
  const fileExplorerWorkspacePath = selectEffectiveFileExplorerWorkspacePath(workspaceIdStore);

  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  // Only tab membership and selection are local. Content and operation outcomes
  // share the canonical files cache with panel editors.
  let openPaths = $state<Record<string, string[]>>({});
  // svelte-ignore state_referenced_locally - intentional: prop seeds the initial selection; user selection owns it afterwards
  let selectedFile: string = $state(initialFile || '');
  const selectedPathStore = writable('');
  const entries$ = selectAllFileContentEntries(workspaceIdStore);
  const selectedEntry$ = selectFileContentEntry(workspaceIdStore, selectedPathStore);
  const currentFileContent = $derived($selectedEntry$?.localContent ?? '');
  const isLoading = $derived($selectedEntry$?.loading ?? false);
  const error = $derived($selectedEntry$?.error ?? null);
  const isBinary = $derived($selectedEntry$?.isBinary ?? false);
  let downloading = $state(false);
  const openFiles = $derived.by(() => {
    const entries = new Map($entries$.map((entry) => [entry.path, entry]));
    return new Map(
      (openPaths[workspaceId] ?? []).map((path) => {
        const entry = entries.get(path);
        return [path, { modified: !!entry && entry.localContent !== entry.originalContent }];
      }),
    );
  });
  $effect(() => {
    selectedPathStore.set(selectedFile);
  });

  // Get breadcrumb parts from file path
  function getBreadcrumbParts(filePath: string): string[] {
    if (!filePath) return [];
    const relativePath = filePath.replace($fileExplorerWorkspacePath, '').replace(/^\//, '');
    return relativePath.split('/').filter(Boolean);
  }

  // Load file content
  function loadFile(filePath: string) {
    const entry = selectFileContentEntry.select(appStore.state, workspaceId, filePath);
    if (entry?.isBinary || (entry?.localContent !== null && entry?.localContent !== undefined))
      return;
    appStore.dispatch(
      loadFileContentRequested(workspaceId, filePath, `${$fileExplorerWorkspacePath}/${filePath}`),
    );
  }

  // Save file
  function saveFile(filePath: string) {
    const entry = selectFileContentEntry.select(appStore.state, workspaceId, filePath);
    if (!entry || entry.kind !== 'editable-text' || entry.localContent === entry.originalContent)
      return;
    appStore.dispatch(
      saveFileContentRequested(
        workspaceId,
        filePath,
        entry.absolutePath ?? filePath,
        editableText(entry.localContent),
      ),
    );
  }

  // Close file
  function closeFile(filePath: string) {
    openPaths[workspaceId] = (openPaths[workspaceId] ?? []).filter((path) => path !== filePath);
    if (selectedFile === filePath) {
      const remainingFiles = openPaths[workspaceId];
      selectedFile = remainingFiles[remainingFiles.length - 1] || '';
    }
  }

  // Handle file selection
  function handleFileSelect(selectedPath: string) {
    const filePath = stripWorkspacePrefix(selectedPath, $fileExplorerWorkspacePath);
    selectedFile = filePath;
    if (!openPaths[workspaceId]?.includes(filePath)) {
      openPaths[workspaceId] = [...(openPaths[workspaceId] ?? []), filePath];
    }
    loadFile(filePath);
  }

  // Handle content changes
  function handleContentChange(newContent: string) {
    if (selectedFile && !isBinary) {
      appStore.dispatch(
        updateFileContent(workspaceId, selectedFile, editableText(newContent), { autoSave: false }),
      );
    }
  }

  async function downloadFile() {
    if (!selectedFile || !workspaceId || downloading || isLoading) return;
    downloading = true;
    try {
      const result = await downloadWorkspaceFile(
        workspaceId,
        selectedFile,
        $fileExplorerWorkspacePath,
      );
      if (!result?.success && !result?.canceled)
        notify.error(result?.error?.message || m.layout_fileTab_downloadFailed_error());
    } catch {
      notify.error(m.layout_fileTab_downloadFailed_error());
    } finally {
      downloading = false;
    }
  }

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
    workspaceId;
    const filePath = initialFile;
    if (!$fileExplorerWorkspacePath) return;
    untrack(() => {
      selectedFile = '';
      if (filePath) handleFileSelect(filePath);
    });
  });
</script>

<Sidebar.Provider>
  <FileExplorerSidebar
    {workspaceId}
    onFileSelect={handleFileSelect}
    selectedFile={selectedFile ? `${$fileExplorerWorkspacePath}/${selectedFile}` : ''}
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
              <Button
                size="icon-compact"
                iconOnly
                class="ml-1 size-5 hover:bg-accent"
                onclick={(e) => {
                  e.stopPropagation();
                  closeFile(filePath);
                }}
                aria-label={m.fileExplorer_layout_closeFile_ariaLabel({ fileName })}
              >
                <Fa icon={faXmark} />
              </Button>
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
            <Fa icon={faExclamationCircle} size="2x" class="w-12 h-12 text-danger" />
            <p class="text-sm text-subtle">{error}</p>
          </div>
        </div>
      {:else if isLoading}
        <div class="flex items-center justify-center h-full">
          <IntentMarkLoader size={32} class="text-subtle" />
        </div>
      {:else if selectedFile && isBinary}
        <div class="flex flex-col items-center justify-center h-full gap-3">
          <p class="text-sm text-subtle">{m.editor_fileViewer_binary_label()}</p>
          <Button onclick={downloadFile} disabled={downloading}>
            {m.layout_fileTab_downloadFile_label()}
          </Button>
        </div>
      {:else if selectedFile}
        <CodeEditor
          bind:value={() => currentFileContent, handleContentChange}
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
