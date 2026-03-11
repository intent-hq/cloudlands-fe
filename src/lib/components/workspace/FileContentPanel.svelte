<script lang="ts">
  /**
   * File Content Panel
   *
   * Displays and allows editing of file content
   */

  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import FileViewer from '$lib/components/editor/FileViewer.svelte';
  import DiffViewer from '$lib/components/ui/diff/DiffViewer.svelte';
  import { Button } from '$lib/components/ui/button';
  import type { BreadcrumbItem } from '$lib/components/ui/content-header/types';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import PanelWrapper from '$lib/components/ui/PanelWrapper.svelte';
  import SaveIndicator from '$lib/components/ui/SaveIndicator.svelte';
  import { Toggle } from '$lib/components/ui/toggle';
  import ViewSettingsDropdown from '$lib/components/ui/ViewSettingsDropdown.svelte';
  import { selectLineWrapping } from '$lib/store/slices/editor-settings/editor-settings-selectors';
  import type { LineChange } from '$lib/utils/line-change-decorations';
  import { faFile, faPencil } from '@fortawesome/free-solid-svg-icons';
  import FileVersionHistoryPicker from './FileVersionHistoryPicker.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import type { CommitInfo, Workspace, WorkspaceId } from '$shared/types';
  import { formatDistanceToNow } from '$lib/utils/date';
  import Fa from 'svelte-fa';

  const lineWrapping = selectLineWrapping();

  const logger = createLogger('FileContentPanel');

  interface Props {
    fileName: string;
    filePath: string;
    /** Relative path to show next to title (optional) */
    fileRelativePath?: string;
    fileContent: string;
    fileLanguage: string;
    isTextFile: boolean;
    isBinary?: boolean;
    isDirty: boolean;
    isSaving: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    jumpToLine?: number | null;
    /** Optional breadcrumbs for category display */
    breadcrumbs?: BreadcrumbItem[];
    /** Line changes to highlight in the gutter (like VS Code) */
    lineChanges?: LineChange[];
    /** Whether the file has uncommitted changes (appears in git status) */
    hasChanges?: boolean;
    /** Workspace ID for file actions */
    workspaceId?: WorkspaceId;
    /** Workspace folder path for file actions */
    workspaceFolderPath?: string;
    /** Optional workspace for version history filtering */
    workspace?: Workspace;
    onContentChange: (content: string) => void;
    onSave: () => void;
    onClose: () => void;
    onNavigateBack: () => void;
    onNavigateForward: () => void;
    /** Callback to view the diff for this file (only shown if file has changes) */
    onViewDiff?: () => void;
    /** Callback when file is deleted */
    onDelete?: () => void;
  }

  let {
    fileName,
    filePath,
    fileRelativePath,
    fileContent,
    fileLanguage,
    isTextFile,
    isBinary,
    isDirty,
    isSaving,
    canGoBack,
    canGoForward,
    jumpToLine,
    breadcrumbs = [{ label: 'Files', icon: faFile }],
    lineChanges = [],
    hasChanges = false,
    workspaceId,
    workspaceFolderPath,
    workspace,
    onContentChange,
    onSave,
    onClose,
    onNavigateBack,
    onNavigateForward,
    onViewDiff,
    onDelete,
  }: Props = $props();

  // State for viewing historical versions
  // Now stores both the old (parent) and new (selected commit) content to show what changed IN the commit
  let selectedVersion = $state<{ commit: CommitInfo; oldContent: string; newContent: string } | null>(null);

  // Version diff view options
  let versionDiffSplit = $state(false);
  let versionDiffFoldUnchanged = $state(true);

  function handleVersionSelect(commit: CommitInfo | null, _commits: CommitInfo[], content?: string, parentContent?: string) {
    if (commit && content !== undefined) {
      // oldContent = content at parent commit (what it was before this commit)
      // newContent = content at selected commit (what it became after this commit)
      selectedVersion = { commit, oldContent: parentContent ?? '', newContent: content };
    } else {
      selectedVersion = null;
    }
  }

  function exitVersionView() {
    selectedVersion = null;
  }

  function handleDeleteFile() {
    onDelete?.();
    onClose();
  }

  // Get directory path (without filename) for subtitle display
  let directoryPath = $derived.by(() => {
    if (!fileRelativePath) return undefined;
    const parts = fileRelativePath.split('/');
    if (parts.length <= 1) return undefined; // No directory path for root files
    parts.pop(); // Remove filename
    return parts.join('/');
  });

  // Local state for content to enable two-way binding
  // Initialize empty, then sync from props to avoid capturing a reactive prop in $state.
  let localContent = $state('');

  // Show diff indicators toggle (file-specific, not shared)
  let showDiffIndicators = $state(true);

  // Computed line changes based on toggle
  let effectiveLineChanges = $derived(showDiffIndicators ? lineChanges : []);

  // Update local content when prop changes
  $effect(() => {
    if (localContent !== fileContent) {
      localContent = fileContent;
    }
  });

  // Notify parent when content changes
  $effect(() => {
    if (localContent !== fileContent) {
      onContentChange(localContent);
    }
  });

  // Handle keyboard shortcuts
  function handleKeyDown(e: KeyboardEvent) {
    // Cmd/Ctrl + S to save
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (isDirty && !isSaving) {
        onSave();
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<PanelWrapper
  title={fileName}
  subtitle={directoryPath}
  {breadcrumbs}
  {onClose}
  showClose={true}
  {canGoBack}
  {canGoForward}
  {onNavigateBack}
  {onNavigateForward}
>
  {#snippet actions()}
    <div class="flex items-center gap-1">
      {#if onViewDiff && (lineChanges.length > 0 || hasChanges)}
        <Button variant="ghost-light" size="icon-xs" onclick={onViewDiff} title="View changes" tooltip="View changes">
          <Fa icon={faPencil} />
        </Button>
      {/if}
      <!-- Version history picker hidden for now
      {#if workspaceId}
        <FileVersionHistoryPicker
          {workspaceId}
          {filePath}
          {workspace}
          selectedCommitHash={selectedVersion?.commit.hash}
          hasLocalChanges={hasChanges || lineChanges.length > 0}
          onCommitSelect={handleVersionSelect}
        />
      {/if}
      -->
      {#if isTextFile}
        <ViewSettingsDropdown
          showFold={false}
          showWrap
          showSplit={false}
          showDiff={hasChanges || lineChanges.length > 0}
          bind:diffEnabled={showDiffIndicators}
        />
      {/if}
      {#if isDirty}
        <SaveIndicator {isSaving} {onSave} />
      {/if}
      <OpenComboButton filePath={filePath} isDirectory={false} variant="sidebar" class="ml-0.5" workspaceFolderPath={workspaceFolderPath} />
    </div>
  {/snippet}

  <div class="w-full h-full flex-1 overflow-hidden">
    {#if selectedVersion}
      <!-- Viewing version diff -->
      <div class="h-full flex flex-col">
        <div class="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border text-xs">
          {#if selectedVersion.commit.hash === 'HEAD'}
            <!-- Local changes: comparing HEAD to working copy -->
            <span class="w-2 h-2 rounded-full bg-yellow-500"></span>
            <span class="font-medium text-yellow-600 dark:text-yellow-400">Uncommitted changes</span>
            <span class="text-subtle">— Last commit → Working copy</span>
          {:else}
            <!-- Historical version: comparing old commit to current -->
            <span class="text-subtle">Comparing</span>
            <span class="font-medium">{formatDistanceToNow(selectedVersion.commit.date)}</span>
            <span class="text-subtle">by {selectedVersion.commit.author}</span>
          {/if}

          <div class="flex items-center gap-1 ml-auto">
            <!-- Fold toggle -->
            <Toggle
              variant="indicator"

          class="-mt-px"
              size="xs"
              pressed={versionDiffFoldUnchanged}
              onLabel="Fold"
              offLabel="Fold"
              onclick={() => versionDiffFoldUnchanged = !versionDiffFoldUnchanged}
            />
            <!-- Split toggle -->
            <Toggle
              variant="indicator"
                        class="-mt-px"
              size="xs"
              pressed={versionDiffSplit}
              onLabel="Split"
              offLabel="Split"
              onclick={() => versionDiffSplit = !versionDiffSplit}
            />
            <Button variant="ghost" size="xs" onclick={exitVersionView}>
              Back to editing
            </Button>
          </div>
        </div>
        <div class="flex-1 overflow-auto">
          <DiffViewer
            oldContent={selectedVersion.oldContent}
            newContent={selectedVersion.newContent}
            fileName={filePath}
            language={fileLanguage}
            showHeader={false}
            viewMode={versionDiffSplit ? 'split' : 'unified'}
            expandUnchanged={!versionDiffFoldUnchanged}
          />
        </div>
      </div>
    {:else if isTextFile}
      <CodeEditor
        bind:value={localContent}
        language={fileLanguage}
        jumpTo={jumpToLine ? { line: jumpToLine } : undefined}
        lineChanges={effectiveLineChanges}
        lineWrapping={$lineWrapping}
      />
    {:else}
      <FileViewer {filePath} {fileContent} {isBinary} />
    {/if}
  </div>
</PanelWrapper>
