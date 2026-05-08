<script lang="ts">
  import type { Note, AgentMessage, AgentSession } from '$shared/types';
  import type { WorkspaceId, AgentId } from '$shared/types/branded-ids';
  import { createLogger } from '$lib/utils/client-logger';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { writable } from 'svelte/store';
  import TaskStatusIndicator from './TaskStatusIndicator.svelte';
  import Fa from 'svelte-fa';
  import { faPlay } from '@fortawesome/free-solid-svg-icons';
  import { agentService } from '$features/agent/agent-ipc-bridge';
  import {
    getFileChangesFromMessages,
    type ChatFileChange,
  } from '$lib/utils/get-file-changes-from-messages';
  import { SPEC_NOTE_ID } from '$shared/constants/notes';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { selectActiveWorkspace } from '$lib/store/slices/workspace/workspace-selectors';
  import { selectAllNotes } from '$lib/store/slices/workspace-notes/workspace-notes-selectors';
  import {
    selectAgentById,
    selectAllWorkspaceAgents,
  } from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
  import { openAgentTabRequested } from '$lib/store/slices/app-layout/app-layout-slice';
  import { openWorkspaceChatChanges } from '$lib/store/slices/workspace-navigation/workspace-navigation-slice';
  import { runAgentForNoteRequested } from '$lib/store/slices/workspace-agents/workspace-agents-slice';

  const logger = createLogger('NoteMetadataBar');

  // Props
  let {
    workspaceId,
    note,
  }: {
    workspaceId: WorkspaceId;
    note: Note;
  } = $props();

  // Mirror workspaceId into a writable so selectors react to prop changes.
  const workspaceIdStore = writable(workspaceId as string);
  $effect(() => {
    workspaceIdStore.set(workspaceId as string);
  });

  // Reactive list of workspace agents. selectAllWorkspaceAgents already
  // scopes to the current workspace, so no manual filtering is needed.
  const workspaceAgents$ = selectAllWorkspaceAgents(workspaceIdStore);

  // Derived state
  const isTask = $derived(!!note.metadata?.task);
  const taskMetadata = $derived(note.metadata?.task);
  const assignedAgentIds = $derived(taskMetadata?.assignedAgentIds || []);
  const isSpec = $derived(note.id === SPEC_NOTE_ID);
  const activeWorkspace = selectActiveWorkspace();

  // Get child tasks (notes that have this note as parent)
  const allNotes$ = selectAllNotes(workspaceId as string);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const childTasks = $derived.by(() => {
    const allNotes = $allNotes$;
    return allNotes.filter((n) => n.parentId === note.id && n.metadata?.task);
  });

  const allAgents = $derived($workspaceAgents$);

  // Sort assigned agents by creation date (oldest first)
  const assignedAgents = $derived.by(() => {
    const uniqueAgentIds = [...new Set(assignedAgentIds)];
    return uniqueAgentIds.sort((a, b) => {
      const agentA = allAgents.find((agent) => agent.id === a);
      const agentB = allAgents.find((agent) => agent.id === b);
      const dateA = agentA?.createdAt ? new Date(agentA.createdAt).getTime() : Infinity;
      const dateB = agentB?.createdAt ? new Date(agentB.createdAt).getTime() : Infinity;
      return dateA - dateB;
    });
  });

  function getAgentName(agentId: AgentId): string {
    const session = allAgents.find((agent) => agent.id === agentId);
    return session?.name || 'Agent';
  }

  // Track which agents we've already tried to load
  const loadAttemptedAgents = new Set<string>();

  // Effect to load missing agents from disk
  $effect(() => {
    const workspace = $activeWorkspace;
    if (!workspace) return;

    const missingAgentIds = assignedAgentIds.filter(
      (agentId) =>
        !allAgents.some((agent) => agent.id === agentId) && !loadAttemptedAgents.has(agentId),
    );

    if (missingAgentIds.length > 0) {
      for (const agentId of missingAgentIds) {
        loadAttemptedAgents.add(agentId);
      }
      for (const agentId of missingAgentIds) {
        agentService.restoreSessionWithoutBackend(agentId, workspace).catch((error) => {
          logger.warn('Failed to load assigned agent from disk', { agentId, error });
        });
      }
    }
  });

  function handleAgentClick(e: MouseEvent, agentId: AgentId) {
    const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const openInAdjacentPanel = e.metaKey || e.ctrlKey;
    getReduxStore().dispatch(
      openAgentTabRequested(workspaceId, {
        agentId,
        sourcePanelId,
        openInAdjacentPanel,
      }),
    );
  }

  // Handle running an agent for this note (creates agent and sends initial message)
  function handleRunAgent() {
    getReduxStore().dispatch(
      runAgentForNoteRequested(workspaceId, note.id, note.title || 'Task'),
    );
  }

  async function getAggregateChanges(): Promise<ChatFileChange[]> {
    const allMessages: AgentMessage[] = [];
    const workspace = selectActiveWorkspace.select(getReduxStore().getState());

    for (const agentId of assignedAgents) {
      try {
        let agent: AgentSession | null | undefined = selectAgentById.select(
          getReduxStore().getState(),
          agentId,
        );
        if (!agent && workspace) {
          agent = await agentService.restoreSession(agentId, workspace);
        }
        if (agent?.messages) {
          allMessages.push(...agent.messages);
        }
      } catch (error) {
        logger.error('Error loading agent messages', { agentId, error });
      }
    }

    const summary = getFileChangesFromMessages(allMessages);
    return summary.changes;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleViewAllChanges() {
    try {
      const changes = await getAggregateChanges();
      if (changes.length === 0) return;

      getReduxStore().dispatch(
        openWorkspaceChatChanges(
          workspaceId as string,
          changes as never,
          `Changes from task: ${note.title || 'Task'}`,
          { isAggregate: true },
        ),
      );
    } catch (error) {
      logger.error('Error viewing all changes', error);
    }
  }
</script>

{#if !isSpec && isTask && taskMetadata}
  <!-- Task note metadata (template is in header) -->
  <div class="w-full flex justify-center">
    <div class="w-full max-w-[var(--content-max-width,60rem)] px-[var(--content-gutter-left)] pt-12 mb-6 flex flex-col">
      <!-- Status row -->
      <div class="grid grid-cols-[120px_1fr] items-start min-h-7 py-0.5 min-w-0">
        <div class="text-subtle pt-0.5">Status</div>
        <div class="flex items-center min-h-6 -mt-0.5">
          <TaskStatusIndicator
            {workspaceId}
            noteId={note.id}
            status={taskMetadata.status}
            compact
          />
        </div>
      </div>

      <!-- Assignee row -->
      <div class="grid grid-cols-[120px_1fr] items-start min-h-7 py-0.5 min-w-0">
        <div class="text-subtle pt-0.5">Assignee</div>
        <div class="flex flex-col gap-1.5 min-h-6 min-w-0 overflow-hidden">
          {#if assignedAgents.length === 0}
            <button
              onclick={handleRunAgent}
              class="inline-flex items-center justify-center h-6 w-4 rounded text-muted-foreground hover:text-muted-foreground transition-colors cursor-pointer"
              title="Run agent"
            >
              <Fa icon={faPlay} class="text-xs" />
            </button>
          {:else}
            <div class="flex flex-wrap items-center gap-1.5 min-w-0">
              {#each assignedAgents as agentId (agentId)}
                <button
                  onclick={(e) => handleAgentClick(e, agentId)}
                  class="inline-flex items-center gap-1 min-w-0 py-0.5 pl-0.5 pr-2 rounded bg-muted/30 px-2 cursor-pointer"
                >
                  <AuggieAvatar size={22} {agentId} />
                  <span class="truncate font-medium text-subtle -mt-0.5"
                    >{getAgentName(agentId) || 'Agent'}</span
                  >
                </button>
              {/each}
              <button
                onclick={handleRunAgent}
                class="inline-flex items-center justify-center h-6 w-4 rounded text-muted-foreground hover:text-muted-foreground transition-colors cursor-pointer"
                title="Run agent"
              >
                <Fa icon={faPlay} class="text-xs" />
              </button>
            </div>
            <!-- <button
              onclick={handleViewAllChanges}
              class= text-muted-foreground hover:text-muted-foreground transition-colors cursor-pointer text-left"
            >
              View all changes
            </button> -->
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
