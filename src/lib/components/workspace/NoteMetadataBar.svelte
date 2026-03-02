<script lang="ts">
  import type { Note, AgentMessage } from '$shared/types';
  import type { WorkspaceId, AgentId } from '$shared/types/branded-ids';
  import { createLogger } from '$lib/utils/client-logger';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { useAllAgentsSubscription } from '$lib/utils/agent-subscription.svelte';
  import { notesStateManager } from '$features/notes/notes.store.svelte';
  import TaskStatusIndicator from './TaskStatusIndicator.svelte';
  import Fa from 'svelte-fa';
  import { faPlay } from '@fortawesome/free-solid-svg-icons';
  import { agentService } from '$features/agent/agent.service';
  import {
    getFileChangesFromMessages,
    type ChatFileChange,
  } from '$lib/utils/get-file-changes-from-messages';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { SPEC_NOTE_ID } from '$shared/constants/notes';

  const logger = createLogger('NoteMetadataBar');

  // Props
  let {
    workspaceId,
    note,
  }: {
    workspaceId: WorkspaceId;
    note: Note;
  } = $props();

  // Subscribe to all agents. Pass workspaceId to trigger loading from disk if needed.
  const allAgentsSubscription = useAllAgentsSubscription(() => workspaceId as string);

  // Derived state
  const isTask = $derived(!!note.metadata?.task);
  const taskMetadata = $derived(note.metadata?.task);
  const assignedAgentIds = $derived(taskMetadata?.assignedAgentIds || []);
  const isSpec = $derived(note.id === SPEC_NOTE_ID);

  // Get child tasks (notes that have this note as parent)
  const childTasks = $derived.by(() => {
    const notesMap = notesStateManager.notes;
    if (!notesMap) return [];
    const allNotes = Array.from(notesMap.values());
    return allNotes.filter((n) => n.parentId === note.id && n.metadata?.task);
  });

  // Filter agents by workspaceId using $derived - this is reactive to workspaceId prop changes
  const allAgents = $derived.by(() => {
    const agents = allAgentsSubscription.all;
    if (!workspaceId) return agents;
    const wsIdStr = String(workspaceId);
    return agents.filter((s) => {
      const agentWsId = s.workspaceId ? String(s.workspaceId) : '';
      return agentWsId === wsIdStr;
    });
  });

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
    const workspace = workspaceStore.current;
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
    window.dispatchEvent(
      new CustomEvent('workspace:open-agent', {
        detail: { agentId, sourcePanelId, openInAdjacentPanel },
      }),
    );
  }

  // Handle running an agent for this note (creates agent and sends initial message)
  function handleRunAgent() {
    window.dispatchEvent(
      new CustomEvent('run-agent-for-note', {
        detail: {
          noteId: note.id,
          noteTitle: note.title || 'Task',
        },
      }),
    );
  }

  async function getAggregateChanges(): Promise<ChatFileChange[]> {
    const allMessages: AgentMessage[] = [];
    const workspace = workspaceStore.current;

    for (const agentId of assignedAgents) {
      try {
        let agent = agentService.getSession(agentId);
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

  async function handleViewAllChanges() {
    try {
      const changes = await getAggregateChanges();
      if (changes.length === 0) return;

      window.dispatchEvent(
        new CustomEvent('workspace:open-chat-changes', {
          detail: {
            changes,
            title: `Changes from task: ${note.title || 'Task'}`,
            isAggregate: true,
          },
        }),
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
                  <AuggieAvatar size={22} colorSeed={agentId} faceSeed={agentId} />
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
