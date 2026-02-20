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

  const logger = createLogger('TaskMetadataBar');

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

  // Get child tasks (notes that have this note as parent)
  // This is the simplified dependency model - sidebar hierarchy IS the task graph
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
  // We no longer filter out agents that aren't loaded yet - they will be loaded
  // asynchronously and the UI will update when they become available.
  // This fixes the issue where assigned agents weren't showing after page refresh
  // because the agent store wasn't populated yet when the component rendered.
  // We also deduplicate to prevent duplicate key errors in the UI.
  const assignedAgents = $derived.by(() => {
    // Deduplicate agent IDs to prevent duplicate key errors
    const uniqueAgentIds = [...new Set(assignedAgentIds)];
    return uniqueAgentIds.sort((a, b) => {
      const agentA = allAgents.find((agent) => agent.id === a);
      const agentB = allAgents.find((agent) => agent.id === b);
      // If agent isn't loaded yet, put it at the end (use Infinity for missing dates)
      const dateA = agentA?.createdAt ? new Date(agentA.createdAt).getTime() : Infinity;
      const dateB = agentB?.createdAt ? new Date(agentB.createdAt).getTime() : Infinity;
      return dateA - dateB; // Oldest first, unloaded agents at the end
    });
  });

  // Get agent name from session
  function getAgentName(agentId: AgentId): string {
    const session = allAgents.find((agent) => agent.id === agentId);
    return session?.name || 'Agent';
  }

  // Track which agents we've already tried to load to avoid duplicate attempts
  const loadAttemptedAgents = new Set<string>();

  // Effect to load missing agents from disk
  // This ensures that assigned agents are loaded even if they weren't part of the initial load
  $effect(() => {
    const workspace = workspaceStore.current;
    if (!workspace) return;

    // Find agents that are assigned but not loaded
    const missingAgentIds = assignedAgentIds.filter(
      (agentId) =>
        !allAgents.some((agent) => agent.id === agentId) && !loadAttemptedAgents.has(agentId),
    );

    if (missingAgentIds.length > 0) {
      logger.info('Loading missing assigned agents from disk', {
        missingAgentIds,
        totalAssigned: assignedAgentIds.length,
        totalLoaded: allAgents.length,
      });

      // Mark as attempted before loading to prevent duplicate attempts
      for (const agentId of missingAgentIds) {
        loadAttemptedAgents.add(agentId);
      }

      // Load each missing agent
      for (const agentId of missingAgentIds) {
        agentService.restoreSessionWithoutBackend(agentId, workspace).catch((error) => {
          logger.warn('Failed to load assigned agent from disk', { agentId, error });
        });
      }
    }
  });

  // Handle clicking on an assigned agent
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

  // Handle running an agent for this task (creates agent and sends initial message)
  function handleRunAgent() {
    // Dispatch event to create and run an agent linked to this note
    // The agent will be sent an initial message to start working immediately
    window.dispatchEvent(
      new CustomEvent('run-agent-for-note', {
        detail: {
          noteId: note.id,
          noteTitle: note.title || 'Task',
        },
      }),
    );
  }

  // Aggregate file changes from all assigned agents
  async function getAggregateChanges(): Promise<ChatFileChange[]> {
    const allMessages: AgentMessage[] = [];
    const workspace = workspaceStore.current;

    logger.info('Getting aggregate changes', {
      assignedAgentsCount: assignedAgents.length,
      assignedAgents: assignedAgents,
      hasWorkspace: !!workspace,
    });

    for (const agentId of assignedAgents) {
      try {
        // Get agent session with messages
        let agent = agentService.getSession(agentId);
        logger.info('Agent from getSession', {
          agentId,
          found: !!agent,
          messageCount: agent?.messages?.length,
        });

        // If not in memory, try to restore from disk
        if (!agent && workspace) {
          agent = await agentService.restoreSession(agentId, workspace);
          logger.info('Agent from restoreSession', {
            agentId,
            found: !!agent,
            messageCount: agent?.messages?.length,
          });
        }

        if (agent?.messages) {
          logger.info('Adding messages from agent', {
            agentId,
            messageCount: agent.messages.length,
            assistantMessages: agent.messages.filter((m) => m.role === 'assistant').length,
            messagesWithContentBlocks: agent.messages.filter((m) => m.contentBlocks?.length).length,
          });
          allMessages.push(...agent.messages);
        }
      } catch (error) {
        logger.error('Error loading agent messages', { agentId, error });
      }
    }

    logger.info('Total messages collected', {
      count: allMessages.length,
      assistantCount: allMessages.filter((m) => m.role === 'assistant').length,
    });

    // Extract file changes from all messages
    const summary = getFileChangesFromMessages(allMessages);
    logger.info('File changes summary', {
      totalFiles: summary.totalFiles,
      totalAdditions: summary.totalAdditions,
      totalDeletions: summary.totalDeletions,
    });
    return summary.changes;
  }

  // Handle viewing all changes from all assigned agents
  async function handleViewAllChanges() {
    try {
      const changes = await getAggregateChanges();

      if (changes.length === 0) {
        logger.info('No changes found from assigned agents');
        return;
      }

      // Dispatch event to open chat changes view
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

{#if isTask && taskMetadata}
  <div class="w-full flex justify-center">
    <div class="w-full max-w-[var(--content-max-width,60rem)] pl-14 pt-12 pr-4 mb-6 flex flex-col">
      <!-- Status row -->
      <div class="grid grid-cols-[120px_1fr] items-start min-h-7 py-0.5 min-w-0">
        <div class="text-muted-foreground/70 text-sm pt-0.5">Status</div>
        <div class="flex items-center min-h-6">
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
        <div class="text-muted-foreground/70 text-sm pt-0.5">Assignee</div>
        <div class="flex flex-col gap-1.5 min-h-6 min-w-0 overflow-hidden">
          {#if assignedAgents.length === 0}
            <button
              onclick={handleRunAgent}
              class="inline-flex min-w-0 items-center justify-center size-6 rounded bg-muted/30 text-muted-foreground/70 truncate min-w-0 hover:bg-muted/50 hover:text-muted-foreground transition-colors cursor-pointer"
              title="Run agent"
            >
              <Fa icon={faPlay} class="text-xs" />
            </button>
          {:else}
            <div class="flex flex-wrap items-center gap-1.5 min-w-0">
              {#each assignedAgents as agentId (agentId)}
                <button
                  onclick={(e) => handleAgentClick(e, agentId)}
                  class="inline-flex items-center gap-2 min-w-0 py-0.5 pl-0.5 pr-2 rounded bg-muted/30 px-2 cursor-pointer"
                >
                  <AuggieAvatar
                    size={22}
                    colorSeed={agentId}
                    faceSeed={agentId}
                    class="mt-[-0.3rem]"
                  />
                  <span class="truncate text-sm text-muted-foreground"
                    >{getAgentName(agentId) || 'Agent'}</span
                  >
                </button>
              {/each}
              <!-- Run agent button -->
              <button
                onclick={handleRunAgent}
                class="inline-flex items-center justify-center size-6 rounded text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-pointer"
                title="Run agent"
              >
                <Fa icon={faPlay} class="text-xs" />
              </button>
            </div>
            <!-- View all changes button -->
            <!-- <button
              onclick={handleViewAllChanges}
              class="text-sm text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-pointer text-left"
            >
              View all changes
            </button> -->
          {/if}
        </div>
      </div>

      <!-- Subtasks row -->
      <div class="grid grid-cols-[120px_1fr] items-start min-h-7 py-0.5 min-w-0">
        <div class="text-muted-foreground/70 text-sm pt-0.5">Subtasks</div>
        <div class="flex items-center gap-2 min-h-6 flex-wrap">
          {#if childTasks.length === 0}
            <span class="text-white/35 text-sm">None</span>
          {:else}
            {#each childTasks as child (child.id)}
              <a
                href="/notes/{child.id}"
                class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted/30 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                <TaskStatusIndicator
                  {workspaceId}
                  noteId={child.id}
                  status={child.metadata?.task?.status || 'not_started'}
                  compact
                />
                <span class="truncate max-w-32">{child.title || 'Untitled'}</span>
              </a>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
