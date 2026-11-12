import type { DraftSyncConnection } from '$lib/components/chat/chat-draft-sync';
import type { DraftsClient } from '$lib/client/app-client';
import type { DockConversationDraft } from '$store/renderer/slices/dock-conversation/dock-conversation-types';
import type {
  PendingSubmission,
  SubmissionScope,
  SubmissionTombstone,
} from '$store/renderer/slices/pending-submissions/pending-submissions-types';
import type { ChatDraftRestore } from '$store/renderer/slices/chat-drafts/chat-drafts-types';
import type { DockComposerEvidence } from '$shared/dock-evidence';
import type { ComposerContextItem } from '$store/renderer/slices/transient-ui/transient-ui-types';
import { dockEvidenceId } from '$shared/dock-evidence';
import { selectComposerContextItems } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
import { selectPendingSubmissionEntry } from '$store/renderer/slices/pending-submissions/pending-submissions-selectors';
import { selectDockComposerEvidence } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
import type { ChatDraftSnapshot } from '$store/renderer/slices/chat-drafts/chat-drafts-types';
import type { AgentMessage, ContentBlock, QueuedMessage } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import type { ResourceBlockContents } from '$shared/types/resource-block-identity';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import { chatScrollbackSaga } from '$store/renderer/slices/chat-state/sagas/chat-scrollback-saga';
import { ThemeManager, type Theme } from '$lib/utils/theme';
import { themeSaga } from '$store/renderer/slices/theme/sagas/theme-saga';
import { store } from '$store/renderer/store';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { emitMockIpcEvent, overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { installMockElectronBridge } from '../../../test/ct-mock-electron-bridge';
import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';
import { principalReceived } from '$store/renderer/slices/principal/principal-slice';
import { initRendererStoreBridge } from '$store/renderer/renderer-store-bridge';
import { dockConversationSaga } from '$store/renderer/slices/dock-conversation/sagas/dock-conversation-saga';
import { appClient } from '$lib/client';
import { startChatFixtureSagas } from '../../../test/chat-fixture-sagas';
import { chatReadSaga } from '$store/renderer/slices/chat-state/sagas/chat-read-saga';
import { chatSubscribeSaga } from '$store/renderer/slices/chat-state/sagas/chat-subscribe-saga';
import { chatSendSaga } from '$store/renderer/slices/chat-state/sagas/chat-send-saga';
import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';
import { closeDockConversationRequested } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
import type { DraftAttachment } from '$lib/client/app-client';
import type { PlaceAttachmentResult } from '$lib/components/chat/input/context-api';
import { createChatDraftFixture } from '../../../test/fixtures/chat-drafts';
import { workspaceCatalogSaga } from '$store/renderer/slices/provider-catalog/workspace-catalog-saga';
import { providerModelsSaga } from '$store/renderer/slices/provider-models/sagas/provider-models-saga';
import { agentModelSaga } from '$store/renderer/slices/agent-model/sagas/agent-model-saga';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';

export interface ComposerDraftSnapshot {
  workspaceId: string | null;
  agentId: string | null;
  draft: DockConversationDraft | undefined;
  evidence: DockComposerEvidence | null;
  restore: ChatDraftRestore | null;
  scope: SubmissionScope | undefined;
  submission: PendingSubmission | undefined;
  tombstone: SubmissionTombstone | undefined;
  contextItems: ComposerContextItem[];
  recoveryItems: ComposerContextItem[];
}

export function readComposerDraftSnapshot(): ComposerDraftSnapshot {
  const { workspaceId, agentId } = store.state.dockConversation;
  const draft =
    workspaceId && agentId
      ? getItem(store.state.dockConversation.drafts, dockEvidenceId(workspaceId, agentId))
      : undefined;
  const reference = draft?.delivery?.reference;
  const entry = reference
    ? selectPendingSubmissionEntry.select(store.state, reference.scope)
    : undefined;
  const restore =
    getItems(store.state.chatDrafts.owners).find(
      (owner) =>
        owner.id.startsWith('dock-conversation:') &&
        owner.restore?.workspaceId === workspaceId &&
        owner.restore.agentId === agentId,
    )?.restore ?? null;
  return {
    workspaceId,
    agentId,
    draft,
    restore,
    evidence:
      workspaceId && agentId
        ? selectDockComposerEvidence.select(store.state, workspaceId, agentId).evidence
        : null,
    scope: entry?.scope,
    submission: entry && reference ? getItem(entry.submissions, reference.id) : undefined,
    tombstone: entry && reference ? getItem(entry.tombstones, reference.id) : undefined,
    contextItems:
      workspaceId && agentId
        ? selectComposerContextItems.select(store.state, workspaceId, agentId)
        : [],
    recoveryItems: draft?.delivery?.recovery ? getItems(draft.delivery.recovery.contextItems) : [],
  };
}

export interface ConversationWireCall {
  method: string;
  params: Record<string, unknown>;
}
const timestamp = '2026-10-22T01:00:00.000Z';
export const conversationWireWorkspace = 'conversation-wire';
const conversationWireQuestionId = '55d59402-06d1-4c51-bec4-f37c0a1b4b23';
type ConversationWireMessage = Omit<AgentMessage, 'contentBlocks'> & {
  contentBlocks?: Array<ContentBlock | { type: 'resource'; resource: ResourceBlockContents }>;
};
const questionRow: ConversationWireMessage = {
  id: conversationWireQuestionId,
  agentId: AgentId('wire-main'),
  role: 'assistant',
  timestamp,
  contentBlocks: [
    {
      type: 'resource',
      resource: {
        uri: 'intent://question/wire-colour',
        mimeType: QUESTION_RESOURCE_MIME_TYPE,
        text: JSON.stringify({
          attachmentId: 'tar-wire-colour',
          header: 'Appearance',
          question: 'Which appearance should we use?',
          options: [{ label: 'Follow the system' }, { label: 'Always dark' }],
        }),
      },
    },
  ],
};

/** Only the daemon/preload boundary is synthetic. All conversation and chat owners are real. */
export function setupConversationWire(
  record: (call: ConversationWireCall) => void,
  options: {
    draftsClient?: DraftsClient;
    draftSync?: DraftSyncConnection;
    failPlacementOnce?: boolean;
    initialMessage?: string;
    /** Persisted synthetic draft, restored by the real owner saga on open. */
    initialDraft?: ChatDraftSnapshot;
    dockAppearance?: boolean;
    /** Seed the main agent with this many assistant turns of operational (thinking) rows. */
    operationalHistory?: number;
    /** A second ready provider (Claude Code), and effort levels on Auggie's models. */
    providerChoice?: boolean;
    /** Exercise the real composer's model/profile trigger at constrained widths. */
    modelLabel?: string;
    profileName?: string;
    /** Workspace the synthetic agents belong to (e.g. the virtual Assistant workspace). */
    workspaceId?: string;
    /** List no agents until `publishAgents()`. */
    withoutAgents?: boolean;
  } = {},
) {
  const wireWorkspace = options.workspaceId ?? conversationWireWorkspace;
  let agentsListed = !options.withoutAgents;
  const root = document.documentElement;
  const previousWindow = root.dataset.auxiliaryWindow;
  const previousClass = root.className;
  const previousStyle = root.getAttribute('style');
  const previousOverride = root.getAttribute('data-theme-override');
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const previousThemeColor = themeColor?.content;
  if (options.dockAppearance) {
    root.dataset.auxiliaryWindow = 'dock';
    ThemeManager.resetInstance();
  }
  const subscriptions = new Map<string, { agentId: string; seq: number }>();
  const drafts = options.draftsClient ?? createChatDraftFixture().client;
  if (options.initialDraft)
    void drafts.set(
      wireWorkspace,
      'wire-main',
      options.initialDraft.text,
      options.initialDraft.attachments,
    );
  const placements = new Map<string, PlaceAttachmentResult>();
  let rejectPlacement = options.failPlacementOnce ?? false;
  let nextId = 0;
  let releaseSend: ((result: unknown) => void) | undefined;
  let releaseEnhancement: (() => void) | undefined;
  const restoreModels = overrideMockIpcHandler('auggie:get-models', (params) => {
    record({ method: 'auggie:get-models', params: (params ?? {}) as Record<string, unknown> });
    const effortLevels = options.providerChoice ? { effortLevels: ['low', 'medium', 'high'] } : {};
    return {
      success: true,
      data: [
        {
          value: 'opus4.7',
          label: options.modelLabel ?? 'Opus 4.7',
          isDefault: true,
          ...effortLevels,
        },
        { value: 'sonnet4.5', label: 'Sonnet 4.5', ...effortLevels },
      ],
    };
  });
  const restoreClaudeModels = options.providerChoice
    ? overrideMockIpcHandler('claude-code:get-models', (params) => {
        record({
          method: 'claude-code:get-models',
          params: (params ?? {}) as Record<string, unknown>,
        });
        return {
          success: true,
          data: [{ value: 'claude-fixture', label: 'Claude fixture', isDefault: true }],
        };
      })
    : () => {};
  const providerEntries = [
    {
      id: 'auggie',
      displayName: 'Augment Auggie',
      shortName: 'Auggie',
      command: 'auggie',
      canBeDisabled: true,
      visible: true,
      ...(options.profileName ? { supportsProfiles: true } : {}),
    },
    ...(options.providerChoice
      ? [
          {
            id: 'claude-code',
            displayName: 'Claude Code',
            shortName: 'Claude',
            command: 'claude',
            // Always on: no workspace enabled-providers setting is needed.
            canBeDisabled: false,
            visible: true,
          },
        ]
      : []),
  ];
  const providerIds = providerEntries.map((entry) => entry.id);
  const messages = new Map<string, ConversationWireMessage[]>();
  const queues = new Map<string, QueuedMessage[]>();
  let pendingQuestion = false;
  let dismissedQuestion = false;
  let failDismiss = false;
  let lastSend: ConversationWireCall | undefined;
  function setQuestionMarker(value: string): void {
    store.dispatch(
      updateSession('wire-main', {
        metadataPatch: {
          pendingQuestionsMessageId: { op: 'set', value },
        },
      }),
    );
  }
  function message(agentId: string, text: string, id = `${agentId}-initial`): AgentMessage {
    return {
      id,
      agentId: AgentId(agentId),
      role: 'assistant',
      timestamp,
      seq: 1,
      contentBlocks: [{ type: 'text', text }],
    };
  }
  /** Session fields accepted through `agent.update` (provider choice only). */
  const agentChanges = new Map<string, Record<string, unknown>>();
  function agent(id: string, workspaceId = wireWorkspace) {
    const main = id === 'wire-main' || id.endsWith(':wire-main');
    return {
      id,
      workspaceId,
      name: main ? 'Wire coordinator' : 'Wire specialist',
      status: 'runtime_idle',
      provider: 'auggie',
      model: 'opus4.7',
      acpSessionId: id,
      isInitialAgent: main,
      metadata: {
        isInitialAgent: main,
        ...(main && pendingQuestion
          ? { pendingQuestionsMessageId: dismissedQuestion ? '' : conversationWireQuestionId }
          : {}),
      },
      ...(!main
        ? {
            parentAgentId: workspaceId === wireWorkspace ? 'wire-main' : `${workspaceId}:wire-main`,
          }
        : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...agentChanges.get(id),
    };
  }
  function history(agentId: string): ConversationWireMessage[] {
    return Array.from({ length: options.operationalHistory ?? 0 }, (_, turn) => ({
      id: `${agentId}-history-${turn}`,
      agentId: AgentId(agentId),
      role: 'assistant' as const,
      timestamp,
      seq: turn + 1,
      contentBlocks: [
        ...Array.from({ length: 6 }, (_, row) => ({
          type: 'thinking' as const,
          id: `${agentId}-t${turn}-r${row}`,
          text: `## Inspecting step ${turn}.${row}\n\nChecking file ${row} of turn ${turn}.`,
        })),
        { type: 'text' as const, text: `Turn ${turn} finished.` },
      ],
    }));
  }
  function transcript(agentId: string) {
    if (!messages.has(agentId))
      messages.set(agentId, [
        ...(agentId === 'wire-main' ? history(agentId) : []),
        message(agentId, options.initialMessage ?? `Live history for ${agentId}`),
      ]);
    return {
      agentId,
      messages: messages.get(agentId),
      totalMessages: messages.get(agentId)?.length,
      truncated: false,
      nextToken: null,
      isResponding: false,
      turnInFlight: false,
    };
  }
  function publish(subscriptionId: string) {
    const entry = subscriptions.get(subscriptionId);
    if (!entry) return;
    const notification = {
      method: 'subscription.push',
      params: {
        subscriptionId,
        kind: 'snapshot',
        seq: entry.seq++,
        snapshot: transcript(entry.agentId),
      },
    };
    emitMockIpcEvent(IPC_CHANNELS.BACKEND.NOTIFICATION, notification);
  }
  let serviceRows: import('$features/scripts/types').ScriptListEntry[] = [];
  let statusOverride: import('$features/scripts/types').ScriptRuntimeState | null = null;
  let holdServiceList = false;
  const serviceListWaiters: (() => void)[] = [];
  async function request(method: string, params: Record<string, unknown>) {
    record({ method, params: structuredClone(params) });
    const agentId = String(params.agentId ?? 'wire-main');
    switch (method) {
      case 'client.hello':
        return { server: { capabilities: { scriptActiveLists: 1, boundedReads: 1 } } };
      case 'script.list': {
        const scripts = structuredClone(
          serviceRows.filter((row) => row.workspaceId === params.workspaceId),
        );
        if (holdServiceList) await new Promise<void>((resolve) => serviceListWaiters.push(resolve));
        return { view: 'summary', scripts };
      }
      case 'script.status':
        return structuredClone(
          statusOverride ??
            serviceRows.find(
              (row) => row.workspaceId === params.workspaceId && row.id === params.scriptId,
            )?.runtime ??
            null,
        );
      case 'providers.catalog':
        return {
          providers: providerEntries,
          ...(options.profileName
            ? {
                profiles: [
                  {
                    id: 'footer-profile',
                    providerRef: 'auggie@footer-profile',
                    baseProviderId: 'auggie',
                    name: 'Work',
                  },
                ],
                defaultNames: { auggie: options.profileName },
              }
            : {}),
        };
      case 'host.providerDiscovery':
        return { providers: providerIds.map((id) => ({ id, installed: true })) };
      case 'host.providerAuthStatus':
        return { providers: providerIds.map((id) => ({ id, authenticated: true })) };
      case 'settings.list':
        return { settings: [{ path: 'model.defaultProvider', value: 'auggie' }], revision: 1 };
      case 'specialist.list':
        return { specialists: [] };
      case 'mcp.servers.list':
        return { servers: [] };
      case 'skill.list':
        return [];
      case 'workspace.get':
        return {
          workspace: {
            id: String(params.workspaceId ?? wireWorkspace),
            title:
              getItem(
                store.state.workspace.workspaces,
                WorkspaceId(String(params.workspaceId ?? wireWorkspace)),
              )?.title ?? 'Connected companion fixture',
            status: 'active',
            myRole: 'owner',
            canManage: true,
            path: '/synthetic/conversation',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        };
      case 'agent.list':
        return {
          agents: !agentsListed
            ? []
            : params.scope === 'background'
              ? []
              : params.scope === 'delegated'
                ? [
                    agent(
                      params.workspaceId === wireWorkspace
                        ? 'wire-sub'
                        : `${params.workspaceId}:wire-sub`,
                      String(params.workspaceId),
                    ),
                  ]
                : ['wire-sub', 'wire-main'].map((id) =>
                    agent(
                      params.workspaceId === wireWorkspace ? id : `${params.workspaceId}:${id}`,
                      String(params.workspaceId),
                    ),
                  ),
        };
      case 'agent.get':
        return { agent: agent(agentId, String(params.workspaceId ?? wireWorkspace)) };
      case 'agent.update':
      case 'agent.setModel': {
        if (!options.providerChoice)
          throw new Error(`Unscripted conversation wire method: ${method}`);
        const changes =
          method === 'agent.update'
            ? (params.changes as Record<string, unknown>)
            : { model: params.modelId, provider: params.providerId ?? 'auggie' };
        agentChanges.set(agentId, { ...agentChanges.get(agentId), ...changes });
        // The daemon's agent:updated push, which moves the session to the new model.
        if (method === 'agent.setModel')
          setTimeout(() =>
            store.dispatch(
              updateSession(agentId, {
                model: String(params.modelId),
                provider: String(params.providerId ?? 'auggie'),
              }),
            ),
          );
        return { agent: agent(agentId), modelId: params.modelId };
      }
      case 'agent.getQueue':
        return { queue: queues.get(agentId) ?? [] };
      case 'agent.getConversation':
        if (pendingQuestion && params.aroundMessageId === conversationWireQuestionId)
          return {
            messages: [questionRow],
            totalMessages: 1,
            truncated: false,
            nextToken: null,
            prevToken: null,
          };
        return transcript(agentId);
      case 'agent.dismissQuestions':
        if (failDismiss) {
          failDismiss = false;
          return { success: false, error: 'Synthetic dismissal rejected' };
        }
        dismissedQuestion = true;
        setQuestionMarker('');
        return { success: true };
      case 'drafts.get':
        return drafts.get(String(params.workspaceId), agentId);
      case 'drafts.set':
        return drafts.set(
          String(params.workspaceId),
          agentId,
          String(params.text),
          structuredClone((params.attachments ?? []) as DraftAttachment[]),
        );
      case 'drafts.clear':
        return drafts.clear(String(params.workspaceId), agentId);
      case 'file.placeAttachment': {
        if (params.workspaceId !== wireWorkspace || typeof params.data !== 'string')
          throw new Error('Fixture accepts only in-memory attachment bytes for its workspace');
        if (rejectPlacement) {
          rejectPlacement = false;
          throw new Error('Synthetic image placement rejected');
        }
        const key = String(params.idempotencyKey ?? `unkeyed-${++nextId}`);
        const prior = placements.get(key);
        if (prior) return { ...prior, replayed: true };
        const placed: PlaceAttachmentResult = {
          ok: true,
          attachmentId: `04591a54-6b26-4b9d-8f62-${String(placements.size + 1).padStart(12, '0')}`,
          path: `.intent/attachments/${String(params.fileName)}`,
          fileName: String(params.fileName),
          size: atob(params.data).length,
          mimeType: String(params.mimeType ?? 'application/octet-stream'),
          uploadedAt: timestamp,
        };
        placements.set(key, placed);
        return placed;
      }
      case 'chat.subscribe': {
        const subscriptionId = `wire-chat-${++nextId}`;
        subscriptions.set(subscriptionId, { agentId, seq: 0 });
        queueMicrotask(() => publish(subscriptionId));
        return { subscriptionId };
      }
      case 'chat.unsubscribe':
        subscriptions.delete(String(params.subscriptionId));
        return { ok: true };
      case 'agent.queueMessage':
      case 'agent.sendMessage': {
        lastSend = { method, params: structuredClone(params) };
        const result = await new Promise<unknown>((resolve) => {
          releaseSend = resolve;
        });
        if (result instanceof Error) throw result;
        return result;
      }
      case 'agent.enhancePrompt':
        return await new Promise<unknown>((resolve) => {
          releaseEnhancement = () =>
            resolve({
              original: String(params.prompt),
              enhanced: `Enhanced: ${String(params.prompt)}`,
              mode: 'enhance',
            });
        });
      default:
        throw new Error(`Unscripted conversation wire method: ${method}`);
    }
  }
  const restoreBridge = installMockElectronBridge((method, params) =>
    request(method, (params ?? {}) as Record<string, unknown>),
  );
  initRendererStoreBridge(store);
  admitLegacyPrincipal();
  const principal = store.state.principal;
  if (!principal.context || !principal.snapshot) throw new Error('Fixture principal not admitted');
  store.dispatch(
    principalReceived(
      {
        context: principal.context,
        invalidation: principal.invalidation,
        presentationVersion: principal.presentationVersion,
      },
      {
        ...principal.snapshot,
        capabilities: { ...principal.snapshot.capabilities, submissionCorrelation: 1 },
      },
    ),
  );
  const stops = [
    workspaceCatalogSaga,
    providerModelsSaga,
    agentModelSaga,
    lifecycleReadSaga,
    chatReadSaga,
    chatScrollbackSaga,
    chatSubscribeSaga,
    chatSendSaga,
    agentMutationSaga,
    dockConversationSaga,
    ...(options.dockAppearance ? [themeSaga] : []),
  ].map((saga) => store.runSaga(saga));
  // Drafts go through the mock backend. The shared helper replaces the CT
  // bootstrap's draft saga instead of running a second one beside it.
  stops.push(
    ...startChatFixtureSagas(store, {
      get: (...args) => appClient.drafts.get(...args),
      set: (...args) => appClient.drafts.set(...args),
      clear: (...args) => appClient.drafts.clear(...args),
      sync: options.draftSync,
    }),
  );
  return {
    readDraft(workspaceId: string, agentId: string) {
      return drafts.get(workspaceId, agentId);
    },
    setServices(
      rows: import('$features/scripts/types').ScriptListEntry[],
      override: import('$features/scripts/types').ScriptRuntimeState | null = null,
    ) {
      serviceRows = rows;
      statusOverride = override;
    },
    holdServiceList(value: boolean) {
      holdServiceList = value;
      if (!value) for (const resolve of serviceListWaiters.splice(0)) resolve();
    },
    emit(channel: string, payload: unknown) {
      emitMockIpcEvent(channel, payload);
    },
    askQuestions(recover = false) {
      pendingQuestion = true;
      dismissedQuestion = false;
      transcript('wire-main');
      if (!recover) messages.get('wire-main')?.push(questionRow);
      setQuestionMarker(conversationWireQuestionId);
      for (const [id, entry] of subscriptions) if (entry.agentId === 'wire-main') publish(id);
    },
    publishAgents() {
      agentsListed = true;
    },
    failNextDismissal() {
      failDismiss = true;
    },
    loseSendResponse() {
      const resolve = releaseSend;
      releaseSend = undefined;
      if (!resolve) throw new Error('No pending synthetic delivery');
      resolve(new Error('Synthetic response lost after write'));
    },
    setThemePreference(preference: Theme) {
      ThemeManager.getInstance().setTheme(preference, { persist: false });
    },
    enhance() {
      const resolve = releaseEnhancement;
      releaseEnhancement = undefined;
      if (!resolve) throw new Error('No pending synthetic enhancement');
      resolve();
    },
    settle(accepted = true) {
      const resolve = releaseSend;
      releaseSend = undefined;
      if (!resolve) throw new Error('No pending synthetic delivery');
      if (accepted && lastSend?.method === 'agent.queueMessage') {
        const params = lastSend.params;
        const queued: QueuedMessage = {
          id: 'wire-answer-queue',
          content: String(params.message ?? params.content ?? ''),
          queuedAt: timestamp,
          position: 0,
          turnId: 'wire-answer-queue',
          messageMetadata: params.messageMetadata as QueuedMessage['messageMetadata'],
          submissionIds: [String(params.messageId)],
        };
        queues.set(String(params.agentId), [queued]);
        resolve({ success: true, queuedMessage: queued });
      } else
        resolve(
          accepted ? { success: true } : { success: false, error: 'Synthetic explicit rejection' },
        );
    },
    append(agentId: string, text: string) {
      transcript(agentId);
      messages.get(agentId)?.push(message(agentId, text, `live-${++nextId}`));
      for (const [id, entry] of subscriptions) if (entry.agentId === agentId) publish(id);
    },
    dispose() {
      store.dispatch(closeDockConversationRequested());
      releaseSend?.({ success: false, error: 'Fixture disposed' });
      releaseEnhancement?.();
      stops.reverse().forEach((stop) => stop());
      if (options.dockAppearance) {
        if (previousWindow === undefined) delete root.dataset.auxiliaryWindow;
        else root.dataset.auxiliaryWindow = previousWindow;
        root.className = previousClass;
        if (previousStyle === null) root.removeAttribute('style');
        else root.setAttribute('style', previousStyle);
        if (previousOverride === null) root.removeAttribute('data-theme-override');
        else root.setAttribute('data-theme-override', previousOverride);
        if (themeColor && previousThemeColor !== undefined) themeColor.content = previousThemeColor;
      }
      subscriptions.clear();
      restoreModels();
      restoreClaudeModels();
      restoreBridge();
    },
  };
}
