import { takeEvery } from "redux-saga/effects";
import { call, put, select } from "typed-redux-saga";
import { agentFactory } from "$features/agent/services/agent-factory";
import { agentService } from "$features/agent/agent.service";
import { workspaceStore } from "$features/workspace/workspace.store.svelte";
import { notesClient } from "$features/notes/notes.client";
import { notesStateManager } from "$features/notes/notes.store.svelte";
import { terminalManager } from "$features/terminal/terminal-manager.svelte";
import { unifiedIdService } from "$shared/services/unified-id.service";
import { WorkspaceId, NoteId } from "$shared/types/branded-ids";
import { generateSpecialistAgentName } from "$lib/utils/agent-name-generator";
import { selectActiveProviderId } from "$lib/store/slices/provider-settings/provider-settings-selectors";
import { selectSpecialists, selectEffectiveCodingAgent, selectEffectiveModel, selectEffectiveBehaviorPrompt, } from "$lib/store/slices/specialists/specialists-selectors";
import { selectWorkspaceDefaultModel } from "$lib/store/slices/model/model-selectors";
import { createAgentTypeId, parseAgentTypeId } from "$shared/types/agent.types";
import { AgentStatus } from "$shared/types";
import type { AgentSession } from "$shared/types";
import { SPEC_NOTE_ID } from "$shared/constants/notes";
import { taskNoteUrl } from "$shared/constants/intent-links";
import { buildTaskNoteContent } from "$features/notes/utils/task-agent-message-builder";
import { stripMarkdownFormatting } from "$shared/utils-client";
import { track } from "$lib/services/analytics";
import { getPanelLayoutManager, hasPanelLayoutManager, } from "$features/layout/panel-layout-manager.svelte";
import { addAgent, clearInitialAgentConfig, createAgentRequested, createAgentWithSpecialistRequested, delegateTaskRequested, markAgentRecentlyCreated as markAgentRecentlyCreatedAction, } from "../workspace-agents-slice";
import { selectAllWorkspaceAgents } from "../workspace-agents-selectors";
import { addTerminal, markTerminalRecentlyCreated, createTerminalRequested, } from "../../terminals/terminals-slice";
/**
 * Open an agent tab in the panel layout manager.
 */
function openAgentInLayout(agentId: string, agentName: string, wsId: string): void {
    if (!hasPanelLayoutManager(wsId))
        return;
    const layoutManager = getPanelLayoutManager(wsId);
    for (const [panelId, panel] of Object.entries(layoutManager.layout.panels)) {
        const existingAgentTab = panel.tabs.find((t) => t.type === "agent" && t.agentId === agentId);
        if (existingAgentTab) {
            layoutManager.focusPanel(panelId);
            layoutManager.setActiveTab(existingAgentTab.id, panelId);
            return;
        }
    }
    layoutManager.openTab({
        type: "agent",
        title: agentName || "Agent",
        agentId,
        closable: true,
    });
}
export function* handleCreateAgentRequestedSaga(wsId: string, agentType?: string) {
    const workspace = workspaceStore.findById(WorkspaceId(wsId));
    if (!workspace) {
        return;
    }
    const workspacePath = workspace.worktreePath || workspace.repositoryPath || workspace.path;
    if (!workspacePath) {
        return;
    }
    // Clear stale agent-config from Redux and sessionStorage
    yield* put(clearInitialAgentConfig(wsId));
    const agentConfigKey = `workspace:${wsId}:agent-config`;
    const staleConfig = sessionStorage.getItem(agentConfigKey);
    if (staleConfig) {
        sessionStorage.removeItem(agentConfigKey);
    }
    const agents: AgentSession[] = yield* select((s) => selectAllWorkspaceAgents.select(s, wsId));
    const existingNames = agents.map((a) => a.name).filter(Boolean) as string[];
    const agentName = generateSpecialistAgentName("Agent", existingNames);
    const model: string = yield* select((s) => selectWorkspaceDefaultModel.select(s, wsId));
    const provider: string = yield* select((s) => selectActiveProviderId.select(s));
    const result: Awaited<ReturnType<typeof agentFactory.createAgent>> = yield* call([agentFactory, agentFactory.createAgent], workspace, {
        name: agentName,
        workspaceId: WorkspaceId(wsId),
        model,
        provider,
        agentType: (agentType && parseAgentTypeId(agentType)) || createAgentTypeId("chat"),
        source: "keyboard-shortcut",
    });
    if (!result.success || !result.agent) {
        return;
    }
    const session = result.agent;
    // Add to agents list if not already present
    if (!agents.some((a) => a.id === session.id)) {
        yield* put(addAgent(wsId, session));
    }
    yield* put(markAgentRecentlyCreatedAction(wsId, session.id));
    // Open the new agent with delay
    setTimeout(() => openAgentInLayout(session.id, session.name || agentName, wsId), 100);
}
export function* handleCreateAgentWithSpecialistRequestedSaga(wsId: string, specialistId: string | null) {
    const workspace = workspaceStore.findById(WorkspaceId(wsId));
    if (!workspace) {
        return;
    }
    const workspacePath = workspace.worktreePath || workspace.repositoryPath || workspace.path;
    if (!workspacePath) {
        return;
    }
    // Clear stale agent-config from Redux and sessionStorage
    yield* put(clearInitialAgentConfig(wsId));
    const agentConfigKey = `workspace:${wsId}:agent-config`;
    const staleConfig = sessionStorage.getItem(agentConfigKey);
    if (staleConfig) {
        sessionStorage.removeItem(agentConfigKey);
    }
    const agents: AgentSession[] = yield* select((s) => selectAllWorkspaceAgents.select(s, wsId));
    const existingNames = agents.map((a) => a.name).filter(Boolean) as string[];
    let model: string = yield* select((s) => selectWorkspaceDefaultModel.select(s, wsId));
    let provider: string = yield* select((s) => selectActiveProviderId.select(s));
    let behaviorPrompt: string | undefined;
    let specialistBaseName = "Agent";
    if (specialistId) {
        const specialists: ReturnType<typeof selectSpecialists.select> = yield* select((s) => selectSpecialists.select(s));
        const specialist = specialists.find((s) => s.id === specialistId);
        if (specialist) {
            specialistBaseName = specialist.name;
            provider = yield* select((s) => selectEffectiveCodingAgent.select(s, specialistId!));
            model = yield* select((s) => selectEffectiveModel.select(s, specialistId!));
            behaviorPrompt = yield* select((s) => selectEffectiveBehaviorPrompt.select(s, specialistId!));
        }
    }
    const agentName = generateSpecialistAgentName(specialistBaseName, existingNames);
    const result: Awaited<ReturnType<typeof agentFactory.createAgent>> = yield* call([agentFactory, agentFactory.createAgent], workspace, {
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
        return;
    }
    const session = result.agent;
    // Add to agents list if not already present
    if (!agents.some((a) => a.id === session.id)) {
        yield* put(addAgent(wsId, session));
    }
    yield* put(markAgentRecentlyCreatedAction(wsId, session.id));
    // Open the new agent with delay
    setTimeout(() => openAgentInLayout(session.id, session.name || agentName, wsId), 100);
}
export function* handleDelegateTaskRequestedSaga(wsId: string, taskText: string, openAgent?: boolean) {
    const workspace = workspaceStore.findById(WorkspaceId(wsId));
    if (!workspace) {
        return;
    }
    const workspacePath = workspace.worktreePath || workspace.repositoryPath || workspace.path;
    if (!workspacePath) {
        return;
    }
    // Step 1: Generate IDs immediately for optimistic UI
    const optimisticAgentId = unifiedIdService.generateAgentId();
    const optimisticNoteId = unifiedIdService.generateNoteId();
    // Step 2: Build content and add optimistic note
    const parentNoteId = SPEC_NOTE_ID;
    const parentNote = notesStateManager.findById(NoteId(parentNoteId));
    const parentNoteTitle = parentNote?.title || "Workspace Spec";
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
        contentType: "task" as const,
        visibility: "private" as const,
        taskStatus: "in_progress" as const,
        createdAt: now,
        updatedAt: now,
        created_at: now,
        updated_at: now,
        is_pinned: false,
        is_archived: false,
    };
    notesStateManager.addOptimisticNote(optimisticNote as any);
    try {
        const defaultModel: string = yield* select((s) => selectWorkspaceDefaultModel.select(s, wsId));
        // Step 3: Create the Task Note with agent via createPrerequisiteNote
        const result: Awaited<ReturnType<typeof notesClient.createPrerequisiteNote>> = yield* call({
            context: notesClient,
            fn: notesClient.createPrerequisiteNote,
        }, WorkspaceId(wsId), NoteId(parentNoteId), {
            title: sanitizedTitle,
            content: taskNoteContent,
            taskStatus: "in_progress" as const,
            agentConfig: {
                instruction: taskText,
                model: defaultModel,
                autoStart: true,
                agentId: optimisticAgentId,
            },
        });
        if (!result.ok) {
            // Rollback: remove optimistic note
            notesStateManager.removeOptimisticNote(optimisticNoteId);
            throw new Error(result.error || "Failed to create Task Note");
        }
        const { note: taskNote, agent: agentData } = result.data;
        // Step 4: Replace optimistic note with real note from server
        notesStateManager.removeOptimisticNote(optimisticNoteId);
        notesStateManager.addOptimisticNote(taskNote);
        // Step 5: Add agent session to stores if agent was created
        if (agentData) {
            const agents: AgentSession[] = yield* select((s) => selectAllWorkspaceAgents.select(s, wsId));
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
                yield* put(addAgent(wsId, session));
            }
            yield* put(markAgentRecentlyCreatedAction(wsId, agentData.id));
            // Open the agent tab if requested
            if (openAgent) {
                setTimeout(() => openAgentInLayout(agentData.id, agentData.name || taskText.slice(0, 40), wsId), 100);
            }
        }
        // Step 6: Convert the checklist item in spec to a linked task
        const specContent = notesStateManager.spec?.content || "";
        if (specContent && taskNote.id) {
            const escapedTaskText = taskText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const taskRegex = new RegExp(`^(\\s*[-*]\\s*\\[[ xX\\/]\\]\\s*)${escapedTaskText}(\\s*)$`, "gm");
            const escapedLinkText = taskText
                .replace(/\\/g, "\\\\")
                .replace(/`/g, "\\`")
                .replace(/\[/g, "\\[")
                .replace(/\]/g, "\\]");
            const linkedTaskText = `$1[${escapedLinkText}](${taskNoteUrl(taskNote.id)})$2`;
            const updatedSpecContent = specContent.replace(taskRegex, linkedTaskText);
            if (updatedSpecContent !== specContent) {
                yield* call([notesStateManager, notesStateManager.updateNoteContent], NoteId(SPEC_NOTE_ID), updatedSpecContent, true);
            }
        }
        // Reload notes to ensure everything is in sync
        yield* call([notesStateManager, notesStateManager.reloadNotes]);
    }
    catch (error) {
    }
}
export function* handleCreateTerminalRequestedSaga(wsId: string) {
    const workspace = workspaceStore.findById(WorkspaceId(wsId));
    if (!workspace) {
        return;
    }
    const terminalId = `terminal-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    yield* put(addTerminal(wsId, terminalId, "Terminal"));
    terminalManager.saveTerminalMetadata(terminalId, wsId, "Terminal");
    yield* put(markTerminalRecentlyCreated(wsId, terminalId));
    // Open terminal via panel layout
    if (hasPanelLayoutManager(wsId)) {
        const layoutManager = getPanelLayoutManager(wsId);
        layoutManager.openTab({
            type: "terminal",
            title: "Terminal",
            terminalId,
            closable: true,
        });
    }
    // Track terminal opened
    track("Opened Terminal", {
        workspace_id: wsId,
        source: "keyboard-shortcut",
    });
}
export function* watchAgentCreationSaga() {
    yield takeEvery(createAgentRequested.type, function* ({ payload }: ReturnType<typeof createAgentRequested>) {
        const [wsId, agentType] = payload;
        yield* handleCreateAgentRequestedSaga(wsId, agentType);
    });
    yield takeEvery(createAgentWithSpecialistRequested.type, function* ({ payload }: ReturnType<typeof createAgentWithSpecialistRequested>) {
        const [wsId, specialistId] = payload;
        yield* handleCreateAgentWithSpecialistRequestedSaga(wsId, specialistId);
    });
    yield takeEvery(delegateTaskRequested.type, function* ({ payload }: ReturnType<typeof delegateTaskRequested>) {
        const [wsId, taskText, openAgent] = payload;
        yield* handleDelegateTaskRequestedSaga(wsId, taskText, openAgent);
    });
    yield takeEvery(createTerminalRequested.type, function* ({ payload }: ReturnType<typeof createTerminalRequested>) {
        const [wsId] = payload;
        yield* handleCreateTerminalRequestedSaga(wsId);
    });
}
