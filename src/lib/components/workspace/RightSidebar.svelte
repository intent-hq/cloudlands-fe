<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';
  import ContentDrawer from '$lib/components/layout/ContentDrawer.svelte';
  import { slide } from 'svelte/transition';

  interface Props {
    dockContentOpen: boolean;
    drawerOpen: boolean;
    drawerType: 'agent' | 'diff' | 'file' | 'notes' | 'note' | 'code';
    drawerContent: any;
    drawerContentWithStreaming: any;
    workspace: any;
    workspaceId: string;
    agentStatuses: Record<string, 'idle' | 'thinking' | 'running' | 'interrupted' | 'error'>;
    mainContentType: string;
    selectedFile: string;
    selectedNoteId: string;
    onDrawerOpenChange: (open: boolean) => void;
    onAgentStatusChange: (status: string) => void;
    onChatUpdate: (data: any) => void;
    onSendMessage: (message: any) => void;
    onNavigateToAgent: (agentId: string) => void;
    onDrawerBack: () => void;
    onCloseActiveItem: () => void;
  }

  let {
    dockContentOpen,
    drawerOpen,
    drawerType,
    drawerContent,
    drawerContentWithStreaming,
    workspace,
    workspaceId,
    agentStatuses,
    mainContentType,
    selectedFile,
    selectedNoteId,
    onDrawerOpenChange,
    onAgentStatusChange,
    onChatUpdate,
    onSendMessage,
    onNavigateToAgent,
    onDrawerBack,
    onCloseActiveItem,
  }: Props = $props();

  function getCurrentContext():
    | {
        type: 'file' | 'note' | 'spec';
        path?: string;
        title?: string;
        noteId?: string;
      }
    | undefined {
    if (mainContentType === 'file' && selectedFile) {
      return { type: 'file' as const, path: selectedFile };
    } else if (mainContentType === 'notes' && selectedNoteId) {
      if (selectedNoteId === 'workspace-spec') {
        return { type: 'spec' as const };
      } else {
        return {
          type: 'note' as const,
          title: 'Note',
          noteId: selectedNoteId,
        };
      }
    }
    return undefined;
  }
</script>

{#if dockContentOpen && drawerOpen}
  <div
    class="h-full z-10 {drawerOpen ? '' : 'invisible pointer-events-none'}"
    transition:slide={{ axis: 'x' }}
    aria-label="Right sidebar"
  >
    <ResizablePanel
      side="right"
      minWidth={180}
      maxWidth={800}
      defaultWidth={250}
      defaultExpandedWidth={600}
      storageKey="workspace-right-panel-width"
      expandedStorageKey="workspace-right-panel-expanded-width"
      percentageWeight={0.5}
      className="flex-none h-full min-w-0"
      handleClassName="!top-6"
      animateOnMount={true}
      animationDuration={300}
    >
      <ContentDrawer
        bind:isOpen={drawerOpen}
        contentType={drawerType}
        content={drawerContentWithStreaming}
        {workspace}
        workspacePath={workspaceId || ''}
        workspaceId={workspaceId || ''}
        agentStatus={drawerType === 'agent' && drawerContent?.id
          ? agentStatuses[drawerContent.id] || 'idle'
          : 'idle'}
        executionMode="manual"
        onAgentStatusChange={(status) => {
          if (drawerType === 'agent' && drawerContent?.id) {
            onAgentStatusChange(status);
          }
        }}
        {onChatUpdate}
        currentContext={getCurrentContext()}
        onClose={() => {
          onDrawerOpenChange(false);
          dockContentOpen = false;
        }}
        {onSendMessage}
        onStopGeneration={() => logger.info('Stop generation')}
        {onNavigateToAgent}
        onBack={onDrawerBack}
        onDelete={onCloseActiveItem}
      />
    </ResizablePanel>
  </div>
{/if}
