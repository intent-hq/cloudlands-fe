import { ThemeManager, type Theme } from '$lib/utils/theme';
import { themeSaga } from '$store/renderer/slices/theme/sagas/theme-saga';
import { store } from '$store/renderer/store';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';
import { principalReceived } from '$store/renderer/slices/principal/principal-slice';
import { initRendererStoreBridge } from '$store/renderer/renderer-store-bridge';
import { dockConversationSaga } from '$store/renderer/slices/dock-conversation/sagas/dock-conversation-saga';
import { chatDraftsSaga } from '$store/renderer/slices/chat-drafts/sagas/chat-drafts-saga';
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

export interface ConversationWireCall {
  method: string;
  params: Record<string, unknown>;
}
const timestamp = '2026-10-22T01:00:00.000Z';
export const conversationWireWorkspace = 'conversation-wire';

/** Only the daemon/preload boundary is synthetic. All conversation and chat owners are real. */
export function setupConversationWire(
  record: (call: ConversationWireCall) => void,
  options: { failPlacementOnce?: boolean; initialMessage?: string; dockAppearance?: boolean } = {},
) {
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
  const previous = window.electronAPI;
  const listeners = new Map<string, { channel: string; handler: (payload: unknown) => void }>();
  const subscriptions = new Map<string, { agentId: string; seq: number }>();
  const drafts = createChatDraftFixture().client;
  const placements = new Map<string, PlaceAttachmentResult>();
  let rejectPlacement = options.failPlacementOnce ?? false;
  let nextId = 0;
  let releaseSend: ((result: unknown) => void) | undefined;
  let releaseEnhancement: (() => void) | undefined;
  const restoreModels = overrideMockIpcHandler('auggie:get-models', (params) => {
    record({ method: 'auggie:get-models', params: (params ?? {}) as Record<string, unknown> });
    return {
      success: true,
      data: [
        { value: 'opus4.7', label: 'Opus 4.7', isDefault: true },
        { value: 'sonnet4.5', label: 'Sonnet 4.5' },
      ],
    };
  });
  const messages = new Map<string, ReturnType<typeof message>[]>();
  function message(agentId: string, text: string, id = `${agentId}-initial`) {
    return {
      id,
      agentId,
      role: 'assistant',
      timestamp,
      seq: 1,
      contentBlocks: [{ type: 'text', text }],
    };
  }
  function agent(id: string) {
    return {
      id,
      workspaceId: conversationWireWorkspace,
      name: id === 'wire-main' ? 'Wire coordinator' : 'Wire specialist',
      status: 'runtime_idle',
      provider: 'auggie',
      model: 'opus4.7',
      acpSessionId: id,
      isInitialAgent: id === 'wire-main',
      metadata: { isInitialAgent: id === 'wire-main' },
      ...(id === 'wire-sub' ? { parentAgentId: 'wire-main' } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  function transcript(agentId: string) {
    if (!messages.has(agentId))
      messages.set(agentId, [
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
    for (const { channel, handler } of listeners.values())
      if (channel === IPC_CHANNELS.BACKEND.NOTIFICATION) handler(notification);
  }
  async function request(method: string, params: Record<string, unknown>) {
    record({ method, params: structuredClone(params) });
    const agentId = String(params.agentId ?? 'wire-main');
    switch (method) {
      case 'providers.catalog':
        return {
          providers: [
            {
              id: 'auggie',
              displayName: 'Augment Auggie',
              shortName: 'Auggie',
              command: 'auggie',
              canBeDisabled: true,
              visible: true,
            },
          ],
        };
      case 'host.providerDiscovery':
        return { providers: [{ id: 'auggie', installed: true }] };
      case 'host.providerAuthStatus':
        return { providers: [{ id: 'auggie', authenticated: true }] };
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
            id: conversationWireWorkspace,
            title: 'Connected companion fixture',
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
          agents:
            params.scope === 'background'
              ? []
              : params.scope === 'delegated'
                ? [agent('wire-sub')]
                : [agent('wire-sub'), agent('wire-main')],
        };
      case 'agent.get':
        return { agent: agent(agentId) };
      case 'agent.getQueue':
        return { queue: [] };
      case 'agent.getConversation':
        return transcript(agentId);
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
        if (params.workspaceId !== conversationWireWorkspace || typeof params.data !== 'string')
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
      case 'agent.sendMessage':
        return await new Promise<unknown>((resolve) => {
          releaseSend = resolve;
        });
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
  const api = {
    versions: { electron: '0.0.0-browser' },
    invoke: async (channel: string, payload?: unknown) => {
      if (channel !== IPC_CHANNELS.BACKEND.REQUEST) return mockInvoke(channel, payload);
      const { method, params = {} } = payload as {
        method: string;
        params?: Record<string, unknown>;
      };
      try {
        return { ok: true, result: await request(method, params) };
      } catch (error) {
        return { ok: false, error: { code: 'MOCK_UNHANDLED_METHOD', message: String(error) } };
      }
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      const id = `wire-listener-${++nextId}`;
      listeners.set(id, { channel, handler });
      return id;
    },
    offById: (_channel: string, id: string) => {
      listeners.delete(id);
    },
    off: () => {},
    send: () => {},
    removeAllListeners: () => {},
    devInstance: null,
    devPort: null,
  };
  window.electronAPI = api as unknown as Window['electronAPI'];
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
    chatDraftsSaga,
    chatReadSaga,
    chatSubscribeSaga,
    chatSendSaga,
    agentMutationSaga,
    dockConversationSaga,
    ...(options.dockAppearance ? [themeSaga] : []),
  ].map((saga) => store.runSaga(saga));
  return {
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
      listeners.clear();
      subscriptions.clear();
      restoreModels();
      window.electronAPI = previous;
    },
  };
}
