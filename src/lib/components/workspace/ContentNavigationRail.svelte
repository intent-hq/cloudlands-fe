<script lang="ts">
  import { fly } from 'svelte/transition';
  import { faFolderTree, faTimeline } from '@fortawesome/free-solid-svg-icons';
  import { createLogger } from '$lib/utils/client-logger';
  import { invoke } from '$lib/electron-bridge';
  import { toast } from 'svelte-sonner';

  const logger = createLogger('ContentNavigationRail');

  // Components
  import NotesPanel from '$lib/components/notes/NotesPanel.svelte';
  import CodeChangesPanel from '$lib/components/file-tracking/CodeChangesPanel.svelte';
  import { FileTreeView } from '$lib/components/file-explorer';
  import ActivityLog from '$features/log/ActivityLog.svelte';
  import ErrorBoundary from '../ErrorBoundary.svelte';
  import ScrollableSection from '$lib/components/ui/ScrollableSection.svelte';
  import ResizablePanelGroup from '$lib/components/layout/ResizablePanelGroup.svelte';

  import type { Workspace } from '$shared/types';
  import type { PanelVisibilityManager } from '$features/workspace/panel-visibility-manager.svelte';

  // Props
  interface Props {
    workspace: Workspace | null;
    workspaceId: string;
    selectedNoteId: string | null;
    selectedChangeId: string | undefined;
    selectedFile: string;
    hasCodeChanges: boolean;
    hasActivityEvents: boolean;
    loading: boolean;
    workspaceEvents: any[];
    fileTreeView?: FileTreeView | null;
    resizablePanelGroup?: ResizablePanelGroup | null;
    panelVisibilityManager?: PanelVisibilityManager;
    onOpenNote: (noteId: string) => void;
    onOpenFile: (change: any) => void;
    onFileSelect: (filePath: string) => void;
    showCodeDiff: (change: any) => void;
    onCreatePR: () => void;
  }

  let {
    workspace,
    workspaceId,
    selectedNoteId,
    selectedChangeId,
    selectedFile,
    hasCodeChanges,
    hasActivityEvents,
    loading,
    workspaceEvents,
    fileTreeView = $bindable(),
    resizablePanelGroup = $bindable(),
    panelVisibilityManager,
    onOpenNote,
    onOpenFile,
    onFileSelect,
    showCodeDiff,
    onCreatePR,
  }: Props = $props();

  // Reactive visibility state from the manager
  let showNotesPanel = $derived(panelVisibilityManager?.showNotesPanel ?? true);
  let showCodeChangesPanel = $derived(
    panelVisibilityManager?.showCodeChangesPanel ?? hasCodeChanges,
  );
  let showFilesPanel = $derived(panelVisibilityManager?.showFilesPanel ?? true);
  let showActivityLogPanel = $derived(
    panelVisibilityManager?.showActivityLogPanel ?? hasActivityEvents,
  );

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
</script>

<div class="main-navigation-rail relative w-full h-full flex flex-col flex-none z-0 min-h-0" aria-label="Content navigation rail">
  <!-- Resizable Panel Group for sections -->
  <ResizablePanelGroup
    bind:this={resizablePanelGroup}
    panels={[
      {
        id: 'notes',
        minSize: 100,
        collapsible: true,
      },
      {
        id: 'code-changes',
        minSize: 100,
        collapsible: true,
      },
      {
        id: 'files',
        minSize: 100,
        collapsible: true,
      },
      {
        id: 'log',
        minSize: 100,
        collapsible: true,
      },
    ]}
    orientation="vertical"
    storageKey="workspace-left-panel"
    className="flex-1 min-h-0"
  >
    {#snippet children(panel: any, index: number, isCollapsed: boolean)}
      {#if panel.id === 'notes' && showNotesPanel}
        <NotesPanel
          workspaceId={workspace?.id || workspaceId}
          selectedNoteId={selectedNoteId ?? undefined}
          {onOpenNote}
        />
      {:else if panel.id === 'code-changes' && showCodeChangesPanel}
        <div class="w-full h-full" transition:fly={{ y: 6, duration: 200 }}>
          <CodeChangesPanel {workspaceId} />
        </div>
      {:else if panel.id === 'files' && showFilesPanel}
        {#if workspaceId && workspace && (workspace.worktreePath || workspace.repositoryPath)}
          <ScrollableSection
            title="Files"
            icon={faFolderTree}
            storageKey="workspace-files-collapsed"
            contentClass=""
            defaultCollapsed
            collapsible
          >
            <FileTreeView
              workspacePath={workspace?.worktreePath || workspace?.repositoryPath || ''}
              {workspaceId}
              environmentConfig={workspace?.environmentConfig}
              {onFileSelect}
              onRenameFile={handleRenameFile}
              bind:selectedFile
              bind:this={fileTreeView}
              isLoading={loading}
            />
          </ScrollableSection>
        {/if}
      {:else if panel.id === 'log' && showActivityLogPanel}
        <div class="w-full h-full" transition:fly={{ y: 6, duration: 200 }}>
          <ScrollableSection
            title="Activity"
            icon={faTimeline}
            collapsible={true}
            storageKey="workspace-log-collapsed"
            className="flex-1 min-h-0"
            contentClass="pb-3 min-h-0 relative"
          >
            <ErrorBoundary componentName="ActivityLog">
              <ActivityLog
                {workspaceId}
                onShowAgent={(agentId: string, event?: MouseEvent) => {
                  // Navigate to the agent
                  const openInAdjacentPanel = event?.metaKey || event?.ctrlKey || false;
                  const panelElement = event?.target
                    ? (event.target as HTMLElement)?.closest('[data-panel-id]')
                    : null;
                  const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
                  window.dispatchEvent(
                    new CustomEvent('workspace:open-agent', {
                      detail: { agentId, openInAdjacentPanel, sourcePanelId },
                    }),
                  );
                }}
                onOpenNote={(noteId: string, event?: MouseEvent) => {
                  // Navigate to the note
                  const openInAdjacentPanel = event?.metaKey || event?.ctrlKey || false;
                  const panelElement = event?.target
                    ? (event.target as HTMLElement)?.closest('[data-panel-id]')
                    : null;
                  const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
                  window.dispatchEvent(
                    new CustomEvent('workspace:open-note', {
                      detail: { noteId, openInAdjacentPanel, sourcePanelId },
                    }),
                  );
                }}
              />
            </ErrorBoundary>
          </ScrollableSection>
        </div>
      {/if}
    {/snippet}
  </ResizablePanelGroup>
</div>
