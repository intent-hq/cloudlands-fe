import { call, put, takeEvery } from 'typed-redux-saga';
import { agentFactory } from '$features/agent/services/agent-factory';
import { agentService } from '$features/agent/agent-ipc-bridge';
import { notesIpc } from '$lib/store/slices/workspace-notes/sagas/notes-ipc';
import { NOTES_CHANNELS } from '$shared/ipc/channels';
import {
  selectNoteById,
  selectSpec,
} from '$lib/store/slices/workspace-notes/workspace-notes-selectors';
import {
  addOptimisticNote,
  removeOptimisticNote,
  updateNoteContent,
  reloadNotes,
} from '$lib/store/slices/workspace-notes/workspace-notes-slice';
import { terminalManager } from '$features/terminal/terminal-manager.svelte';
import { unifiedIdService } from '$shared/services/unified-id.service';
import { WorkspaceId, NoteId } from '$shared/types/branded-ids';
import { generateSpecialistAgentName } from '$lib/utils/agent-name-generator';
import { createLogger } from '$lib/utils/client-logger';
import { selectActiveProviderId } from '$lib/store/slices/provider-settings/provider-settings-selectors';
import {
  selectSpecialists,
  selectEffectiveCodingAgent,
  selectEffectiveModel,
  selectEffectiveBehaviorPrompt,
} from '$lib/store/slices/specialists/specialists-selectors';
import { selectWorkspaceDefaultModel } from '$lib/store/slices/model/model-selectors';
import {
  parseCompoundModelId,
  getDefaultModelForProvider,
  PROVIDER_MODEL_TIERS,
} from '$shared/config/provider-config';
import { SPECIALISTS } from '$lib/constants/specialists';
import { getAgentProvider } from '$shared/types/agent-session';
import { buildTaskAgentInitialMessage } from '$features/notes/utils/task-agent-message-builder';
import { assignAgentToTask } from '$lib/store/slices/workspace-notes/workspace-notes-slice';
import { createAgentTypeId, parseAgentTypeId } from '$shared/types/agent.types';
import { AgentStatus } from '$shared/types';
import type { AgentSession, Workspace } from '$shared/types';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { taskNoteUrl } from '$shared/constants/intent-links';
import { buildTaskNoteContent } from '$features/notes/utils/task-agent-message-builder';
import { stripMarkdownFormatting } from '$shared/utils-client';
import { track } from '$lib/services/analytics';
import {
  focusPanel,
  openTab,
  setActiveTab,
} from '$lib/store/slices/panel-layout/panel-layout-slice';
import { selectPanels } from '$lib/store/slices/panel-layout/panel-layout-selectors';
import { selectWorkspaceById } from '$lib/store/slices/workspace/workspace-selectors';
import {
  addAgent,
  clearInitialAgentConfig,
  createAgentRequested,
  createAgentWithSpecialistRequested,
  delegateExistingTaskRequested,
  delegateTaskRequested,
  markAgentRecentlyCreated as markAgentRecentlyCreatedAction,
  runAgentForNoteRequested,
} from '../workspace-agents-slice';
import { selectAllWorkspaceAgents } from '../workspace-agents-selectors';
import { upsertSession } from '../../agent-session/agent-session-slice';
import {
  addTerminal,
  markTerminalRecentlyCreated,
  createTerminalRequested,
} from '../../terminals/terminals-slice';

const logger = createLogger('agent-creation-saga');

/**
 * Resolve the workspace path used to validate that a workspace can host new
 * agents. Returns null when the workspace lacks any usable filesystem path.
 */
function resolveWorkspacePath(workspace: Workspace): string | null {
  return workspace.worktreePath || workspace.repositoryPath || workspace.path || null;
}

/**
 * Read-and-clear sessionStorage for any stale per-workspace agent config.
 * Wrapped in its own function so saga callers can stub it via `yield* call(...)`.
 */
function clearStaleAgentConfig(wsId: string): void {
  const key = `workspace:${wsId}:agent-config`;
  if (sessionStorage.getItem(key)) {
    sessionStorage.removeItem(key);
  }
}

/**
 * Open an agent tab in the panel layout. If a tab for this agent already
 * exists in any panel, focus it; otherwise dispatch openTab. Reads fresh
 * panels via `selectPanels.effect()` each invocation so callers don't have
 * to lift the read.
 */
function* openAgentInLayoutSaga(agentId: string, agentName: string, wsId: string) {
  const panels = yield* selectPanels.effect(wsId);
  for (const [panelId, panel] of Object.entries(panels)) {
    const existingAgentTab = panel.tabs.find((t) => t.type === 'agent' && t.agentId === agentId);
    if (existingAgentTab) {
      yield* put(focusPanel(wsId, panelId));
      yield* put(setActiveTab(wsId, existingAgentTab.id, panelId));
      return;
    }
  }
  yield* put(
    openTab(wsId, {
      type: 'agent',
      title: agentName || 'Agent',
      agentId,
      closable: true,
    }),
  );
}

/**
 * Validate that a workspace exists and has a usable filesystem path. Returns
 * the workspace when valid; null when the workspace is missing or unusable.
 */
function* validateWorkspace(wsId: string) {
  const workspace = yield* selectWorkspaceById.effect(wsId);
  if (!workspace) return null;
  const workspacePath = resolveWorkspacePath(workspace);
  if (!workspacePath) return null;
  return workspace;
}

/**
 * Validate the workspace and read the agent-creation prerequisites used by
 * both `handleCreateAgentRequestedSaga` and
 * `handleCreateAgentWithSpecialistRequestedSaga`. Also clears any stale
 * agent-config carried over from a prior creation attempt.
 */
function* validateWorkspaceAndModel(wsId: string) {
  const workspace = yield* validateWorkspace(wsId);
  if (!workspace) return null;

  // Clear stale agent-config from Redux and sessionStorage
  yield* put(clearInitialAgentConfig(wsId));
  yield* call(clearStaleAgentConfig, wsId);

  const agents: AgentSession[] = yield* selectAllWorkspaceAgents.effect(wsId);
  const model: string = yield* selectWorkspaceDefaultModel.effect(wsId);
  const globalProvider: string = yield* selectActiveProviderId.effect();
  return { workspace, agents, model, globalProvider };
}

/**
 * Persist a freshly created session into Redux. Skips the session puts when
 * the agent is already present (defensive against double-create races).
 */
function* registerCreatedAgent(
  wsId: string,
  session: AgentSession,
  existingAgents: AgentSession[],
) {
  if (!existingAgents.some((a) => a.id === session.id)) {
    yield* put(upsertSession(session));
    yield* put(addAgent(wsId, session));
  }
  yield* put(markAgentRecentlyCreatedAction(wsId, session.id));
}

export function* handleCreateAgentRequestedSaga(wsId: string, agentType?: string) {
  const ctx = yield* validateWorkspaceAndModel(wsId);
  if (!ctx) return;
  const { workspace, agents, model, globalProvider } = ctx;

  const existingNames = agents.map((a) => a.name).filter(Boolean) as string[];
  const agentName = generateSpecialistAgentName('Agent', existingNames);

  // Derive provider from workspace default model when it contains a provider prefix
  // (e.g., 'claude-code:default' → 'claude-code'). This ensures new agents inherit the
  // workspace's provider rather than the global active provider, which may differ when the
  // user created the workspace with a non-default provider.
  const provider: string = model.includes(':')
    ? parseCompoundModelId(model).providerId
    : globalProvider;

  const result: Awaited<ReturnType<typeof agentFactory.createAgent>> = yield* call(
    [agentFactory, agentFactory.createAgent],
    workspace,
    {
      name: agentName,
      workspaceId: WorkspaceId(wsId),
      model,
      provider,
      agentType: (agentType && parseAgentTypeId(agentType)) || createAgentTypeId('chat'),
      source: 'keyboard-shortcut',
    },
  );
  if (!result.success || !result.agent) return;
  const session = result.agent;

  yield* registerCreatedAgent(wsId, session, agents);

  yield* openAgentInLayoutSaga(session.id, session.name || agentName, wsId);
}

export function* handleCreateAgentWithSpecialistRequestedSaga(
  wsId: string,
  specialistId: string | null,
) {
  const ctx = yield* validateWorkspaceAndModel(wsId);
  if (!ctx) return;
  const { workspace, agents, globalProvider } = ctx;
  let { model } = ctx;

  const existingNames = agents.map((a) => a.name).filter(Boolean) as string[];

  // Derive provider from workspace default model when it contains a provider prefix,
  // so new agents inherit the workspace's provider rather than the global active provider.
  let provider: string = model.includes(':')
    ? parseCompoundModelId(model).providerId
    : globalProvider;
  let behaviorPrompt: string | undefined;
  let specialistBaseName = 'Agent';
  if (specialistId) {
    const specialists = yield* selectSpecialists.effect();
    const specialist = specialists.find((s) => s.id === specialistId);
    if (specialist) {
      specialistBaseName = specialist.name;
      provider = yield* selectEffectiveCodingAgent.effect(specialistId);
      model = yield* selectEffectiveModel.effect(specialistId);
      behaviorPrompt = yield* selectEffectiveBehaviorPrompt.effect(specialistId);
    }
  }
  const agentName = generateSpecialistAgentName(specialistBaseName, existingNames);

  const result: Awaited<ReturnType<typeof agentFactory.createAgent>> = yield* call(
    [agentFactory, agentFactory.createAgent],
    workspace,
    {
      name: agentName,
      workspaceId: WorkspaceId(wsId),
      model,
      provider,
      agentType: createAgentTypeId('chat'),
      behaviorPrompt,
      source: 'specialist-picker',
      metadata: specialistId ? { specialist: specialistId } : undefined,
    },
  );
  if (!result.success || !result.agent) return;
  const session = result.agent;

  yield* registerCreatedAgent(wsId, session, agents);

  yield* openAgentInLayoutSaga(session.id, session.name || agentName, wsId);
}

export function* handleDelegateTaskRequestedSaga(
  wsId: string,
  taskText: string,
  openAgent?: boolean,
) {
  const workspace = yield* validateWorkspace(wsId);
  if (!workspace) return;

  // Step 1: Generate IDs immediately for optimistic UI
  const optimisticAgentId = unifiedIdService.generateAgentId();
  const optimisticNoteId = unifiedIdService.generateNoteId();

  // Step 2: Build content and add optimistic note
  const parentNoteId = SPEC_NOTE_ID;
  const parentNote = yield* selectNoteById.effect(wsId, parentNoteId);
  const parentNoteTitle = parentNote?.title || 'Workspace Spec';
  const taskNoteContent = buildTaskNoteContent(taskText, parentNoteId, parentNoteTitle);

  // Add optimistic note to store immediately (shows in sidebar)
  const now = new Date().toISOString();
  const sanitizedTitle = stripMarkdownFormatting(taskText);
  const optimisticNote = {
    id: optimisticNoteId,
    workspaceId: wsId,
    title: sanitizedTitle,
    content: taskNoteContent,
    tags: [],
    contentType: 'task' as const,
    visibility: 'private' as const,
    taskStatus: 'in_progress' as const,
    createdAt: now,
    updatedAt: now,
    created_at: now,
    updated_at: now,
    is_pinned: false,
    is_archived: false,
  };
  yield* put(addOptimisticNote(wsId, optimisticNote as any));

  try {
    const defaultModel: string = yield* selectWorkspaceDefaultModel.effect(wsId);

    // Step 3: Create the Task Note with agent via createPrerequisiteNote
    const result = yield* call(
      notesIpc<{
        note: import('$shared/types').Note;
        agent?: import('$shared/types').AgentSession;
      }>,
      NOTES_CHANNELS.CREATE_PREREQUISITE_NOTE,
      {
        workspaceId: WorkspaceId(wsId),
        dependentNoteId: NoteId(parentNoteId),
        options: {
          title: sanitizedTitle,
          content: taskNoteContent,
          taskStatus: 'in_progress' as const,
          agentConfig: {
            instruction: taskText,
            model: defaultModel,
            autoStart: true,
            agentId: optimisticAgentId,
          },
        },
      },
    );
    if (!result.ok) {
      // Rollback: remove optimistic note
      yield* put(removeOptimisticNote(wsId, optimisticNoteId));
      throw new Error(result.error || 'Failed to create Task Note');
    }
    const { note: taskNote, agent: agentData } = result.data;

    // Step 4: Replace optimistic note with real note from server
    yield* put(removeOptimisticNote(wsId, optimisticNoteId));
    yield* put(addOptimisticNote(wsId, taskNote));

    // Step 5: Add agent session to stores if agent was created
    if (agentData) {
      const agents: AgentSession[] = yield* selectAllWorkspaceAgents.effect(wsId);
      if (!agents.find((a) => a?.id === agentData.id)) {
        const session: AgentSession = {
          id: agentData.id,
          workspaceId: WorkspaceId(wsId),
          name: agentData.name || taskText.slice(0, 40),
          model: agentData.model || defaultModel,
          createdAt: agentData.createdAt || new Date().toISOString(),
          backendSessionId: agentData.backendSessionId,
          status: AgentStatus.Active,
          messages: [],
          updatedAt: new Date().toISOString(),
        } as AgentSession;
        agentService.addSession(session);
        yield* registerCreatedAgent(wsId, session, agents);
      } else {
        yield* put(markAgentRecentlyCreatedAction(wsId, agentData.id));
      }

      // Open the agent tab if requested
      if (openAgent) {
        yield* openAgentInLayoutSaga(
          agentData.id,
          agentData.name || taskText.slice(0, 40),
          wsId,
        );
      }
    }

    // Step 6: Convert the checklist item in spec to a linked task
    const spec = yield* selectSpec.effect(wsId);
    const specContent = spec?.content || '';
    if (specContent && taskNote.id) {
      const escapedTaskText = taskText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const taskRegex = new RegExp(
        `^(\\s*[-*]\\s*\\[[ xX\\/]\\]\\s*)${escapedTaskText}(\\s*)$`,
        'gm',
      );
      const escapedLinkText = taskText
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
      const linkedTaskText = `$1[${escapedLinkText}](${taskNoteUrl(taskNote.id)})$2`;
      const updatedSpecContent = specContent.replace(taskRegex, linkedTaskText);
      if (updatedSpecContent !== specContent) {
        yield* put(updateNoteContent(wsId, SPEC_NOTE_ID, updatedSpecContent, true));
      }
    }
    // Reload notes to ensure everything is in sync
    yield* put(reloadNotes(wsId));
  } catch (error) {
    logger.error('Failed to delegate task', {
      workspaceId: wsId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Resolve the provider used by the workspace's initial agent session, if any.
 * Returns undefined when the workspace lacks an initial agent (legacy workspaces),
 * letting downstream logic fall back to its own default.
 */
function* getWorkspaceInitialAgentProviderSaga(wsId: string) {
  const sessions: AgentSession[] = yield* selectAllWorkspaceAgents.effect(wsId);
  const initialAgent = sessions.find(
    (s) => String(s.workspaceId) === wsId && s.isInitialAgent,
  );
  if (!initialAgent) return undefined;
  return getAgentProvider(initialAgent);
}

/**
 * Create an agent for an existing Task Note and start it with the task text.
 * Mirrors the pre-Redux noteId branch of the `delegate-task` window event.
 */
export function* handleDelegateExistingTaskRequestedSaga(
  wsId: string,
  noteId: string,
  taskText: string,
  openAgent?: boolean,
) {
  const workspace = yield* validateWorkspace(wsId);
  if (!workspace) return;

  try {
    const existingNote = yield* selectNoteById.effect(wsId, noteId);
    const noteTitle = existingNote?.title || taskText;

    const provider: string | undefined = yield* getWorkspaceInitialAgentProviderSaga(wsId);
    const model: string = yield* selectWorkspaceDefaultModel.effect(wsId);

    const result: Awaited<ReturnType<typeof agentFactory.createAgent>> = yield* call(
      [agentFactory, agentFactory.createAgent],
      workspace,
      {
        name: noteTitle,
        workspaceId: WorkspaceId(wsId),
        model,
        provider,
        agentType: createAgentTypeId('task-loop'),
        source: 'delegate-task',
        metadata: {
          taskNoteId: noteId,
          source: 'task-delegation',
        },
        initialMessage: taskText,
      },
    );
    if (!result.success || !result.agentId) {
      logger.error('Failed to delegate existing task', {
        workspaceId: wsId,
        noteId,
        error: result.error,
      });
      return;
    }

    const createdAgentId = result.agentId;
    yield* put(assignAgentToTask(wsId, noteId, createdAgentId));
    yield* put(reloadNotes(wsId));

    if (openAgent) {
      yield* openAgentInLayoutSaga(createdAgentId, noteTitle, wsId);
    }
  } catch (error) {
    logger.error('Failed to delegate existing task', {
      workspaceId: wsId,
      noteId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Create an implementor agent for a Task Note and immediately send the
 * task-loop initial message. Mirrors the `run-agent-for-note` window event.
 */
export function* handleRunAgentForNoteRequestedSaga(
  wsId: string,
  noteId: string,
  noteTitle?: string,
) {
  const workspace = yield* validateWorkspace(wsId);
  if (!workspace) return;

  try {
    const note = yield* selectNoteById.effect(wsId, noteId);
    if (!note) {
      logger.error('Cannot run agent: note not found', { workspaceId: wsId, noteId });
      return;
    }

    const initialMessage = buildTaskAgentInitialMessage(note);

    // Use implementor specialist for task agents. Try store first, fall back to
    // SPECIALISTS constant if the store returns empty (can happen in async contexts).
    let implementorModel: string = yield* selectEffectiveModel.effect('implementor');
    let implementorBehaviorPrompt: string = yield* selectEffectiveBehaviorPrompt.effect('implementor');

    if (!implementorBehaviorPrompt) {
      const implementorSpec = SPECIALISTS.find((s) => s.id === 'implementor');
      if (implementorSpec) {
        implementorBehaviorPrompt = implementorSpec.defaultBehaviorPrompt;
        if (!implementorModel) {
          const activeProvider: string = yield* selectActiveProviderId.effect();
          implementorModel =
            implementorSpec.defaultModelTier && activeProvider in PROVIDER_MODEL_TIERS
              ? getDefaultModelForProvider(activeProvider, implementorSpec.defaultModelTier)
              : implementorSpec.defaultModel ?? '';
        }
      }
    }

    const provider: string | undefined = yield* getWorkspaceInitialAgentProviderSaga(wsId);
    const fallbackModel: string = yield* selectWorkspaceDefaultModel.effect(wsId);

    const result: Awaited<ReturnType<typeof agentFactory.createAgent>> = yield* call(
      [agentFactory, agentFactory.createAgent],
      workspace,
      {
        name: noteTitle || 'Task Agent',
        workspaceId: WorkspaceId(wsId),
        model: implementorModel || fallbackModel,
        provider,
        agentType: createAgentTypeId('task-loop'),
        behaviorPrompt: implementorBehaviorPrompt,
        source: 'task-metadata-bar-run',
        metadata: {
          taskNoteId: noteId,
          source: 'task-run',
          specialist: 'implementor',
        },
        initialMessage,
      },
    );
    if (!result.success || !result.agentId) {
      logger.error('Failed to run agent for note', {
        workspaceId: wsId,
        noteId,
        error: result.error,
      });
      return;
    }

    const createdAgentId = result.agentId;
    yield* put(assignAgentToTask(wsId, noteId, createdAgentId));
    yield* put(reloadNotes(wsId));
    yield* openAgentInLayoutSaga(createdAgentId, noteTitle || 'Task Agent', wsId);
  } catch (error) {
    logger.error('Failed to run agent for note', {
      workspaceId: wsId,
      noteId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function* handleCreateTerminalRequestedSaga(wsId: string) {
  const workspace = yield* validateWorkspace(wsId);
  if (!workspace) return;

  const terminalId = unifiedIdService.generateTerminalId();
  yield* put(addTerminal(wsId, terminalId, 'Terminal'));
  terminalManager.saveTerminalMetadata(terminalId, wsId, 'Terminal');
  yield* put(markTerminalRecentlyCreated(wsId, terminalId));

  // Open terminal via panel layout
  yield* put(
    openTab(wsId, {
      type: 'terminal',
      title: 'Terminal',
      terminalId,
      closable: true,
    }),
  );

  // Track terminal opened
  track('Opened Terminal', {
    workspace_id: wsId,
    source: 'keyboard-shortcut',
  });
}

export function* watchAgentCreationSaga() {
  yield* takeEvery(
    createAgentRequested,
    function* ({ payload }: ReturnType<typeof createAgentRequested>) {
      const [wsId, agentType] = payload;
      yield* handleCreateAgentRequestedSaga(wsId, agentType);
    },
  );
  yield* takeEvery(
    createAgentWithSpecialistRequested,
    function* ({ payload }: ReturnType<typeof createAgentWithSpecialistRequested>) {
      const [wsId, specialistId] = payload;
      yield* handleCreateAgentWithSpecialistRequestedSaga(wsId, specialistId);
    },
  );
  yield* takeEvery(
    delegateTaskRequested,
    function* ({ payload }: ReturnType<typeof delegateTaskRequested>) {
      const [wsId, taskText, openAgent] = payload;
      yield* handleDelegateTaskRequestedSaga(wsId, taskText, openAgent);
    },
  );
  yield* takeEvery(
    delegateExistingTaskRequested,
    function* ({ payload }: ReturnType<typeof delegateExistingTaskRequested>) {
      const [wsId, noteId, taskText, openAgent] = payload;
      yield* handleDelegateExistingTaskRequestedSaga(wsId, noteId, taskText, openAgent);
    },
  );
  yield* takeEvery(
    runAgentForNoteRequested,
    function* ({ payload }: ReturnType<typeof runAgentForNoteRequested>) {
      const [wsId, noteId, noteTitle] = payload;
      yield* handleRunAgentForNoteRequestedSaga(wsId, noteId, noteTitle);
    },
  );
  yield* takeEvery(
    createTerminalRequested,
    function* ({ payload }: ReturnType<typeof createTerminalRequested>) {
      const [wsId] = payload;
      yield* handleCreateTerminalRequestedSaga(wsId);
    },
  );
}
