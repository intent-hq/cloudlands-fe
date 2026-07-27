<script lang="ts">
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import type { Note,
  AgentMessage,
  AgentSession } from '$shared/types';
  import type { WorkspaceId,
  AgentId } from '$shared/types/branded-ids';
  import { createLogger } from '$lib/utils/client-logger';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import TaskStatusIndicator from './TaskStatusIndicator.svelte';
  import Fa from 'svelte-fa';
  import { faPlay } from '@fortawesome/free-solid-svg-icons';
  import {
  getFileChangesFromMessages,
  type ChatFileChange,
} from '$lib/utils/get-file-changes-from-messages';
  import { SPEC_NOTE_ID } from '$shared/constants/notes';

  import { selectActiveWorkspace } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectAllNotes } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { openWorkspaceChatChanges } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import {
  ensureAgentSessionLoaded,
  restoreAgentSessionRequested,
  runAgentForNoteRequested,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { toStore } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  const logger = createLogger('NoteMetadataBar');

  // Props
  let {
    workspaceId,
    note,
  }: {
    workspaceId: WorkspaceId;
    note: Note;
  } = $props();

  const workspaceId$ = toStore(() => workspaceId as string);

  // Reactive list of workspace agents. selectAllWorkspaceAgents already
  // scopes to the current workspace, so no manual filtering is needed.
  const workspaceAgents$ = selectAllWorkspaceAgents(workspaceId$);

  // Derived state
  const isTask = $derived(!!note.metadata?.task);
  const taskMetadata = $derived(note.metadata?.task);
  const assignedAgentIds = $derived(taskMetadata?.assignedAgentIds || []);
  const isSpec = $derived(note.id === SPEC_NOTE_ID);
  const activeWorkspace = selectActiveWorkspace();

  // Get child tasks (notes that have this note as parent)
  const allNotes$ = selectAllNotes(workspaceId$);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const childTasks = $derived.by(() => {
    const allNotes = $allNotes$;
    return allNotes.filter((n) => n.parentId === note.id && n.metadata?.task);
  });


  // Sort assigned agents by creation date (oldest first)
  const assignedAgents = $derived.by(() => {
    // Keep this derived value reactive to agent session loads while resolving
    // agent details through selector-backed Redux reads below.
    const _workspaceAgents = $workspaceAgents$;
    const state = appStore.state;
    const uniqueAgentIds = [...new Set(assignedAgentIds)];
    return uniqueAgentIds.sort((a, b) => {
      const agentA = selectAgentSession.select(state, a);
      const agentB = selectAgentSession.select(state, b);
      const dateA = agentA?.createdAt ? new Date(agentA.createdAt).getTime() : Infinity;
      const dateB = agentB?.createdAt ? new Date(agentB.createdAt).getTime() : Infinity;
      return dateA - dateB;
    });
  });

  function getAgentName(agentId: AgentId): string {
    // Keep assigned-agent display reactive to agent loads without scanning the
    // workspace agent list for an ID lookup.
    const _workspaceAgents = $workspaceAgents$;
    const session = selectAgentSession.select(appStore.state, agentId);
    return session?.name || m.workspace_fileChanges_agent_label();
  }

  // Track which agents we've already tried to load
  const loadAttemptedAgents = new Set<string>();

  // Effect to load missing agents from disk
  $effect(() => {
    const workspace = $activeWorkspace;
    if (!workspace) return;

    const missingAgentIds = assignedAgentIds.filter(
      (agentId) =>
        !$workspaceAgents$.some((agent) => agent.id === agentId) && !loadAttemptedAgents.has(agentId),
    );

    if (missingAgentIds.length > 0) {
      for (const agentId of missingAgentIds) {
        loadAttemptedAgents.add(agentId);
      }
      for (const agentId of missingAgentIds) {
        appStore.dispatch(ensureAgentSessionLoaded(workspace.id, agentId));
      }
    }
  });

  function handleAgentClick(e: MouseEvent, agentId: AgentId) {
    const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const openInAdjacentPanel = e.metaKey || e.ctrlKey;
    appStore.dispatch(
      openAgentTabRequested(workspaceId, {
        agentId,
        sourcePanelId,
        openInAdjacentPanel,
      }),
    );
  }

  // Handle running an agent for this note (creates agent and sends initial message)
  function handleRunAgent() {
    appStore.dispatch(
      runAgentForNoteRequested(workspaceId, note.id, note.title || m.workspace_noteCodeChanges_task_label()),
    );
  }

  async function getAggregateChanges(): Promise<ChatFileChange[]> {
    const allMessages: AgentMessage[] = [];
    const workspace = selectActiveWorkspace.select(appStore.state);

    for (const agentId of assignedAgents) {
      try {
        let agent: AgentSession | null | undefined = selectAgentSession.select(
          appStore.state,
          agentId,
        );
        if (!agent && workspace) {
          const restoreAction = restoreAgentSessionRequested(workspace.id, agentId);
          appStore.dispatch(restoreAction);
          agent = await restoreAction.promise;
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

      appStore.dispatch(
        openWorkspaceChatChanges(
          workspaceId as string,
          changes as never,
          m.workspace_noteMetadataBar_changesFromTask_label({
            title: note.title || m.workspace_noteCodeChanges_task_label(),
          }),
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
        <div class="text-subtle pt-0.5">{m.workspace_noteMetadataBar_status_label()}</div>
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
        <div class="text-subtle pt-0.5">{m.workspace_noteMetadataBar_assignee_label()}</div>
        <div class="flex flex-col gap-1.5 min-h-6 min-w-0 overflow-hidden">
          {#if assignedAgents.length === 0}
            <button
              onclick={handleRunAgent}
              class="inline-flex items-center justify-center h-6 w-4 rounded text-muted-foreground hover:text-muted-foreground transition-colors cursor-pointer"
              title={m.workspace_noteMetadataBar_runAgent_tooltip()}
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
                    >{getAgentName(agentId)}</span
                  >
                </button>
              {/each}
              <button
                onclick={handleRunAgent}
                class="inline-flex items-center justify-center h-6 w-4 rounded text-muted-foreground hover:text-muted-foreground transition-colors cursor-pointer"
                title={m.workspace_noteMetadataBar_runAgent_tooltip()}
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
