<script lang="ts">
  import PanelWrapper from '$lib/components/ui/PanelWrapper.svelte';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import FileViewer from '$lib/components/editor/FileViewer.svelte';
  import FileActionsDropdown from '$lib/components/ui/FileActionsDropdown.svelte';
  import SaveIndicator from '$lib/components/ui/SaveIndicator.svelte';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faFile, faSave, faSpinner, faCheck } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    selectedFile: string;
    fileContent: string;
    fileLanguage: string;
    isTextFile: boolean;
    isFileDirty: boolean;
    isSaving: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    workspaceId: string;
    workspaceFolderPath?: string;
    onFileRename: (newName: string) => void;
    onSave: () => void;
    onNavigateBack: () => void;
    onNavigateForward: () => void;
    onClose: () => void;
  }

  let {
    selectedFile,
    fileContent,
    fileLanguage,
    isTextFile,
    isFileDirty,
    isSaving,
    canGoBack,
    canGoForward,
    workspaceId,
    workspaceFolderPath,
    onFileRename,
    onSave,
    onNavigateBack,
    onNavigateForward,
    onClose,
  }: Props = $props();
</script>

<PanelWrapper
  title={selectedFile ? selectedFile.split('/').pop() || 'Untitled' : 'Untitled'}
  faIcon={faFile}
  headerClass="px-8 py-3"
  editableTitle={true}
  onTitleChange={onFileRename}
  {onClose}
  showClose={true}
  {canGoBack}
  {canGoForward}
  {onNavigateBack}
  {onNavigateForward}
>
  {#snippet actions()}
    {#if isTextFile}
      <SaveIndicator
        isDirty={isFileDirty}
        {isSaving}
        isAutoSaving={isFileDirty && !isSaving}
        {onSave}
        size="sm"
      />
      <div class="w-px h-4 bg-border mx-1"></div>
    {/if}
    <!-- Note: workspaceFolderPath should be the repository path, not the worktree -->
    <!-- This ensures files open in the correct project context -->
    <FileActionsDropdown
      filePath={selectedFile}
      {workspaceId}
      isDirectory={false}
      isCompact={true}
      variant="ghost"
      size="xs"
      {workspaceFolderPath}
    />
  {/snippet}

  <div class="h-full">
    {#if isTextFile}
      <CodeEditor
        bind:value={fileContent}
        language={fileLanguage}
        fileName={selectedFile}
        lineNumbers={true}
        highlightActiveLine={true}
      />
    {:else}
      <FileViewer filePath={selectedFile} {fileContent} language={fileLanguage} />
    {/if}
  </div>
</PanelWrapper>
