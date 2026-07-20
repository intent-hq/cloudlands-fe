/**
 * Agent creation service — the post-saga handler for the orphaned
 * agent-creation triggers (`createAgentRequested`,
 * `createAgentWithSpecialistRequested`, `runAgentForNoteRequested`,
 * `createAgentFromConfigRequested`, `agentSessionLaunchAgentRequested`).
 *
 * These triggers lost their handlers when the saga runtime was removed (they
 * lived in `slices/workspace-agents/sagas/agent-creation-saga.ts` and
 * `slices/agent-session/sagas/agent-chat-effects-saga.ts`), so Cmd/Ctrl+T, the
 * New-agent / specialist UI, the NoteMetadataBar run button, Chief-of-Staff
 * thread creation, and every direct `createAgentFromConfigRequested` dispatch
 * site (AgentActionBlock, error-toast, panel-ai-layout, ScriptOutputViewer)
 * became no-ops. This restores the behavior WITHOUT re-adding a saga and
 * WITHOUT changing any dispatch site: `createAgentCreationMiddleware()`
 * observes dispatched actions and routes each trigger through the renderer's
 * agent-creation seam.
 *
 * Seam: agent creation goes through `agentFactory.createAgent()` (per AGENTS.md),
 * which is the live path — it invokes the real backend via `AGENT_CHANNELS.CREATE`
 * IPC and upserts the resulting session into the store. `appClient.agents.create`
 * is intentionally NOT used: its `AgentCreateRequest` is too thin (only
 * workspaceId/prompt/model/specialist) and it returns a bare `MutationResult`
 * with no agent object, so it cannot drive the create-and-open flow. That gap is
 * recorded in the BE hand-off note for future seam consolidation.
 *
 * On success the new agent's tab is opened/focused by reusing the 3.A1 open path
 * (`openAgentTabRequested`), so tab dedup/focus semantics stay in one place. The
 * async `createAgentFromConfigRequested` / `agentSessionLaunchAgentRequested`
 * paths honor the caller's launch options (`openAgent`, `openInAdjacentPanel`,
 * `panelId`, `sourcePanelId`) and settle each dispatched action's promise via
 * `action.success` / `action.failure` so awaiting call sites (ChiefCard,
 * AgentActionBlock) resolve or surface a clean error.
 *
 * Dependency-light per src/store AGENTS.md: top-level imports are limited to the
 * configured store, slice actions, store-free helpers/constants, shared types,
 * and the logger. The agent factory and every selector module (which evaluate
 * `store.createSelector` at import) are dynamically imported inside handlers so
 * they are never evaluated while the store is still initializing through the
 * middleware chain.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import type { AgentSession, Workspace } from "$shared/types";
import { AgentStatus } from "$shared/types";
import { createAgentTypeId, parseAgentTypeId } from "$shared/types/agent.types";
import { WorkspaceId, CHIEF_WORKSPACE_ID } from "$shared/types/branded-ids";
import { getAgentProvider } from "$shared/types/agent-session";
import {
  getDefaultModelForProvider,
  parseCompoundModelId,
  PROVIDER_MODEL_TIERS,
} from "$shared/config/provider-config";
import { cleanErrorMessage } from "$shared/errors/messages";
import { unifiedIdService } from "$shared/services/unified-id.service";
import { SPECIALISTS } from "$lib/constants/specialists";
import { generateSpecialistAgentName } from "$lib/utils/agent-name-generator";
import { createChiefVirtualWorkspace } from "$store/renderer/slices/workspace-agents/chief-virtual-workspace";
import { buildTaskAgentInitialMessage } from "$features/notes/utils/task-agent-message-builder";
import { store as appStore } from "$store/renderer/store";
import {
  agentSessionLaunchAgentRequested,
  bulkUpsertSessions,
  upsertSession,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { openAgentTabRequested } from "$store/renderer/slices/app-layout/app-layout-slice";
import {
  openTab,
  openTabInAdjacentOrSplit,
} from "$store/renderer/slices/panel-layout/panel-layout-slice";
import {
  createAgentFromConfigRequested,
  createAgentRequested,
  createAgentWithSpecialistRequested,
  markAgentRecentlyCreated,
  runAgentForNoteRequested,
  setActiveAgentId,
  type AgentCreationRequestOptions,
} from "$store/renderer/slices/workspace-agents/workspace-agents-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("AgentCreationService");

/**
 * Dynamically load the agent factory + selectors used by the handlers. Imported
 * lazily so the `store.createSelector` calls in these modules never run during
 * middleware-chain construction.
 */
async function loadCreationDeps() {
  const [factoryMod, wsSel, waSel, modelSel, provSel, specSel, notesSel] =
    await Promise.all([
      import("$features/agent/services/agent-factory"),
      import("$store/renderer/slices/workspace/workspace-selectors"),
      import("$store/renderer/slices/workspace-agents/workspace-agents-selectors"),
      import("$store/renderer/slices/model/model-selectors"),
      import("$store/renderer/slices/provider-settings/provider-settings-selectors"),
      import("$store/renderer/slices/specialists/specialists-selectors"),
      import("$store/renderer/slices/workspace-notes/workspace-notes-selectors"),
    ]);
  return {
    agentFactory: factoryMod.agentFactory,
    selectWorkspaceById: wsSel.selectWorkspaceById,
    selectAllWorkspaceAgents: waSel.selectAllWorkspaceAgents,
    selectWorkspaceDefaultModel: modelSel.selectWorkspaceDefaultModel,
    selectActiveProviderId: provSel.selectActiveProviderId,
    selectSpecialists: specSel.selectSpecialists,
    selectEffectiveCodingAgent: specSel.selectEffectiveCodingAgent,
    selectEffectiveModel: specSel.selectEffectiveModel,
    selectEffectiveBehaviorPrompt: specSel.selectEffectiveBehaviorPrompt,
    selectNoteById: notesSel.selectNoteById,
  };
}
type CreationDeps = Awaited<ReturnType<typeof loadCreationDeps>>;

function hasUsableAgentSession(session: AgentSession | undefined | null): session is AgentSession {
  return !!session?.backendSessionId && session.status !== AgentStatus.Pending;
}

function resolveWorkspacePath(workspace: Workspace): string | null {
  return workspace.worktreePath || workspace.repositoryPath || workspace.path || null;
}

/** Resolve a hostable workspace for agent creation, or null when unusable. */
function validateWorkspace(wsId: string, deps: CreationDeps): Workspace | null {
  if (wsId === CHIEF_WORKSPACE_ID) return createChiefVirtualWorkspace();
  const workspace = deps.selectWorkspaceById.select(appStore.state, wsId);
  if (!workspace) return null;
  if (!resolveWorkspacePath(workspace)) return null;
  return workspace;
}

/** Open (or focus) the new agent's tab via the shared 3.A1 navigation path. */
function openCreatedAgentTab(wsId: string, agentId: string): void {
  appStore.dispatch(openAgentTabRequested(wsId, { agentId }));
}

/**
 * Persist a freshly created session into Redux (defensive against double-create
 * races) and flag it as recently created for the UI highlight.
 */
function registerCreatedAgent(
  wsId: string,
  session: AgentSession,
  existingAgents: AgentSession[],
): void {
  const existing = existingAgents.find((a) => a.id === session.id);
  const shouldUpsert =
    !existing ||
    (!hasUsableAgentSession(existing) && hasUsableAgentSession(session));
  if (shouldUpsert) {
    const persistable = { ...session, workspaceId: wsId as AgentSession["workspaceId"] };
    appStore.dispatch(bulkUpsertSessions([persistable]));
    appStore.dispatch(upsertSession(persistable));
  }
  appStore.dispatch(markAgentRecentlyCreated(wsId, session.id));
}

/**
 * Resolve the provider used by the workspace's initial agent, if any. Returns
 * undefined for legacy workspaces lacking an initial agent so downstream logic
 * falls back to its own default.
 */
function getWorkspaceInitialAgentProvider(wsId: string, deps: CreationDeps): string | undefined {
  const sessions = deps.selectAllWorkspaceAgents.select(appStore.state, wsId);
  const initialAgent = sessions.find((s) => String(s.workspaceId) === wsId && s.isInitialAgent);
  return initialAgent ? getAgentProvider(initialAgent) : undefined;
}

function getCreationError(error: unknown, fallback = "Failed to create agent"): string {
  if (!error) return fallback;
  return error instanceof Error ? error.message : String(error);
}

/** Cmd/Ctrl+T and the New-agent button: create a chat agent and open its tab. */
async function handleCreateAgentRequested(wsId: string, agentType?: string): Promise<void> {
  const deps = await loadCreationDeps();
  const workspace = validateWorkspace(wsId, deps);
  if (!workspace) return;

  const agents = deps.selectAllWorkspaceAgents.select(appStore.state, wsId);
  const model = deps.selectWorkspaceDefaultModel.select(appStore.state, wsId);
  const globalProvider = deps.selectActiveProviderId.select(appStore.state);

  const existingNames = agents.map((a) => a.name).filter(Boolean) as string[];
  const agentName = generateSpecialistAgentName("Agent", existingNames);
  const provider = model.includes(":") ? parseCompoundModelId(model).providerId : globalProvider;

  try {
    const result = await deps.agentFactory.createAgent(workspace, {
      name: agentName,
      workspaceId: WorkspaceId(wsId),
      model,
      provider,
      agentType: (agentType && parseAgentTypeId(agentType)) || createAgentTypeId("chat"),
      source: "keyboard-shortcut",
    });
    if (!result.success || !result.agent) {
      logger.error("Failed to create agent", { workspaceId: wsId, error: result.error });
      return;
    }
    registerCreatedAgent(wsId, result.agent, agents);
    openCreatedAgentTab(wsId, result.agent.id);
  } catch (error) {
    logger.error("Failed to create agent", { workspaceId: wsId, error: getCreationError(error) });
  }
}

/** Specialist picker: create a chat agent for a specialist and open its tab. */
async function handleCreateAgentWithSpecialist(
  wsId: string,
  specialistId: string | null,
): Promise<void> {
  const deps = await loadCreationDeps();
  const workspace = validateWorkspace(wsId, deps);
  if (!workspace) return;

  const agents = deps.selectAllWorkspaceAgents.select(appStore.state, wsId);
  let model = deps.selectWorkspaceDefaultModel.select(appStore.state, wsId);
  const globalProvider = deps.selectActiveProviderId.select(appStore.state);

  const existingNames = agents.map((a) => a.name).filter(Boolean) as string[];
  let provider = model.includes(":") ? parseCompoundModelId(model).providerId : globalProvider;
  let behaviorPrompt: string | undefined;
  let specialistBaseName = "Agent";
  if (specialistId) {
    const specialist = deps.selectSpecialists
      .select(appStore.state)
      .find((s) => s.id === specialistId);
    if (specialist) {
      specialistBaseName = specialist.name;
      provider = deps.selectEffectiveCodingAgent.select(appStore.state, specialistId);
      model = deps.selectEffectiveModel.select(appStore.state, specialistId);
      behaviorPrompt = deps.selectEffectiveBehaviorPrompt.select(appStore.state, specialistId);
    }
  }
  const agentName = generateSpecialistAgentName(specialistBaseName, existingNames);

  try {
    const result = await deps.agentFactory.createAgent(workspace, {
      name: agentName,
      workspaceId: WorkspaceId(wsId),
      model,
      provider,
      agentType: createAgentTypeId("chat"),
      behaviorPrompt,
      source: "specialist-picker",
      metadata: specialistId ? { specialist: specialistId } : undefined,
    });
    if (!result.success || !result.agent) {
      logger.error("Failed to create specialist agent", { workspaceId: wsId, error: result.error });
      return;
    }
    registerCreatedAgent(wsId, result.agent, agents);
    openCreatedAgentTab(wsId, result.agent.id);
  } catch (error) {
    logger.error("Failed to create specialist agent", {
      workspaceId: wsId,
      error: getCreationError(error),
    });
  }
}

/**
 * NoteMetadataBar run button: create an implementor task-loop agent for a Task
 * Note, seed its initial task message, and open its tab. Task/note state stays
 * in sync via the live-state subscription, so no explicit reload is dispatched.
 */
async function handleRunAgentForNote(
  wsId: string,
  noteId: string,
  noteTitle?: string,
): Promise<void> {
  const deps = await loadCreationDeps();
  const workspace = validateWorkspace(wsId, deps);
  if (!workspace) return;

  const note = deps.selectNoteById.select(appStore.state, wsId, noteId);
  if (!note) {
    logger.error("Cannot run agent: note not found", { workspaceId: wsId, noteId });
    return;
  }

  const initialMessage = buildTaskAgentInitialMessage(note);

  let implementorModel = deps.selectEffectiveModel.select(appStore.state, "implementor");
  let implementorBehaviorPrompt = deps.selectEffectiveBehaviorPrompt.select(
    appStore.state,
    "implementor",
  );
  if (!implementorBehaviorPrompt) {
    const implementorSpec = SPECIALISTS.find((s) => s.id === "implementor");
    if (implementorSpec) {
      implementorBehaviorPrompt = implementorSpec.defaultBehaviorPrompt;
      if (!implementorModel) {
        const activeProvider = deps.selectActiveProviderId.select(appStore.state);
        implementorModel =
          implementorSpec.defaultModelTier && activeProvider in PROVIDER_MODEL_TIERS
            ? getDefaultModelForProvider(activeProvider, implementorSpec.defaultModelTier)
            : implementorSpec.defaultModel ?? "";
      }
    }
  }

  const provider = getWorkspaceInitialAgentProvider(wsId, deps);
  const fallbackModel = deps.selectWorkspaceDefaultModel.select(appStore.state, wsId);

  try {
    const result = await deps.agentFactory.createAgent(workspace, {
      name: noteTitle || "Task Agent",
      workspaceId: WorkspaceId(wsId),
      model: implementorModel || fallbackModel,
      provider,
      agentType: createAgentTypeId("task-loop"),
      behaviorPrompt: implementorBehaviorPrompt,
      source: "task-metadata-bar-run",
      metadata: { taskNoteId: noteId, source: "task-run", specialist: "implementor" },
      initialMessage,
    });
    if (!result.success || !result.agentId) {
      logger.error("Failed to run agent for note", { workspaceId: wsId, noteId, error: result.error });
      return;
    }
    openCreatedAgentTab(wsId, result.agentId);
  } catch (error) {
    logger.error("Failed to run agent for note", {
      workspaceId: wsId,
      noteId,
      error: getCreationError(error),
    });
  }
}

/**
 * Open (or focus) the newly created agent's tab when the caller opted in via
 * `options.openAgent`. Honors `openInAdjacentPanel`/`sourcePanelId` and an
 * explicit `panelId`, mirroring the reference saga's `openCreatedAgent`.
 */
function openCreatedAgentForConfig(
  wsId: string,
  session: AgentSession,
  options: AgentCreationRequestOptions | undefined,
): void {
  if (!options?.openAgent) return;
  if (options.openInAdjacentPanel) {
    appStore.dispatch(
      openTabInAdjacentOrSplit(
        wsId,
        {
          type: "agent",
          title: session.name || "Agent",
          agentId: session.id,
          workspaceId: wsId,
          closable: true,
        },
        options.sourcePanelId,
      ),
    );
    return;
  }
  if (options.panelId) {
    appStore.dispatch(
      openTab(
        wsId,
        {
          type: "agent",
          title: session.name || "Agent",
          agentId: session.id,
          workspaceId: wsId,
          closable: true,
        },
        options.panelId,
      ),
    );
    return;
  }
  openCreatedAgentTab(wsId, session.id);
}

/**
 * `createAgentFromConfigRequested`: async trigger dispatched by the launch
 * handler (and by direct call sites like AgentActionBlock / error-toast /
 * panel-ai-layout / ScriptOutputViewer). Routes through the shared factory
 * seam, registers the session, and settles the caller's promise via
 * `action.success` / `action.failure`.
 */
async function handleCreateAgentFromConfig(
  action: ReturnType<typeof createAgentFromConfigRequested>,
): Promise<void> {
  const [wsId, config, options] = action.payload;
  const deps = await loadCreationDeps();
  const workspace = validateWorkspace(wsId, deps);
  if (!workspace) {
    const errorMessage = "Workspace is not available for agent creation";
    logger.error("Failed to create agent from Redux request", {
      workspaceId: wsId,
      source: config.source,
      error: errorMessage,
    });
    appStore.dispatch(action.failure(new Error(errorMessage)));
    return;
  }

  try {
    const agents = deps.selectAllWorkspaceAgents.select(appStore.state, wsId);
    const result = await deps.agentFactory.createAgent(workspace, {
      ...config,
      workspaceId: WorkspaceId(wsId),
    });
    if (!result.success || !result.agent) {
      const errorMessage = getCreationError(result.error);
      logger.error("Failed to create agent from Redux request", {
        workspaceId: wsId,
        source: config.source,
        error: errorMessage,
      });
      appStore.dispatch(action.failure(new Error(errorMessage)));
      return;
    }

    const session = result.agent;
    registerCreatedAgent(wsId, session, agents);
    appStore.dispatch(setActiveAgentId(wsId, session.id));
    openCreatedAgentForConfig(wsId, session, options);
    appStore.dispatch(action.success(session));
  } catch (error) {
    const errorMessage = getCreationError(error);
    logger.error("Failed to create agent from Redux request", {
      workspaceId: wsId,
      source: config.source,
      error: errorMessage,
    });
    appStore.dispatch(action.failure(error instanceof Error ? error : new Error(errorMessage)));
  }
}

/**
 * `agentSessionLaunchAgentRequested`: async trigger dispatched by ChiefCard
 * (new thread + auto-start) and other launch sites. Resolves the workspace's
 * default model + provider (mirroring the reference saga), then delegates to
 * `createAgentFromConfigRequested` and settles the launch promise with the
 * created session (or a cleaned error message on failure).
 */
async function handleLaunchAgent(
  action: ReturnType<typeof agentSessionLaunchAgentRequested>,
): Promise<void> {
  const [wsId, config, options] = action.payload;
  try {
    const deps = await loadCreationDeps();
    const agentId = config.id ?? unifiedIdService.generateAgentId();
    const model = config.model ?? deps.selectWorkspaceDefaultModel.select(appStore.state, wsId);
    const activeProvider = deps.selectActiveProviderId.select(appStore.state);
    const provider =
      config.provider ??
      (model.includes(":") ? parseCompoundModelId(model).providerId : activeProvider);

    const createAction = createAgentFromConfigRequested(
      wsId,
      {
        ...config,
        id: agentId,
        workspaceId: WorkspaceId(wsId),
        model,
        provider,
      },
      options,
    );
    appStore.dispatch(createAction);
    const session = await createAction.promise;
    appStore.dispatch(action.success(session));
  } catch (error) {
    const errorMessage = cleanErrorMessage(getCreationError(error, "Failed to launch agent"));
    logger.error("Failed to launch agent", {
      workspaceId: wsId,
      source: (config as { source?: string }).source,
      error: errorMessage,
    });
    appStore.dispatch(action.failure(new Error(errorMessage)));
  }
}

/**
 * Middleware that gives the agent-creation triggers real handlers: after each
 * action passes through the (no-op) reducer, it routes the trigger to the
 * matching factory-backed handler. Fire-and-forget — dispatch stays synchronous
 * and never throws.
 */
export function createAgentCreationMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && typeof action.type === "string") {
      const payload = Array.isArray(action.payload) ? action.payload : [];
      switch (action.type) {
        case createAgentRequested.type:
          if (typeof payload[0] === "string") {
            void handleCreateAgentRequested(
              payload[0],
              typeof payload[1] === "string" ? payload[1] : undefined,
            );
          }
          break;
        case createAgentWithSpecialistRequested.type:
          if (typeof payload[0] === "string") {
            void handleCreateAgentWithSpecialist(
              payload[0],
              typeof payload[1] === "string" ? payload[1] : null,
            );
          }
          break;
        case runAgentForNoteRequested.type:
          if (typeof payload[0] === "string" && typeof payload[1] === "string") {
            void handleRunAgentForNote(
              payload[0],
              payload[1],
              typeof payload[2] === "string" ? payload[2] : undefined,
            );
          }
          break;
        case createAgentFromConfigRequested.type:
          void handleCreateAgentFromConfig(
            action as ReturnType<typeof createAgentFromConfigRequested>,
          );
          break;
        case agentSessionLaunchAgentRequested.type:
          void handleLaunchAgent(
            action as ReturnType<typeof agentSessionLaunchAgentRequested>,
          );
          break;
      }
    }
    return result;
  };
}
