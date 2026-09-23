/**
 * Selector-module stand-ins for rendering ChatPanel against a mocked store.
 *
 * Each exported factory returns one module shape; the test file registers it
 * with `vi.mock(path, async () => (await import('./mocks/chat-panel-render-scaffold')).x())`.
 * Mutate `scaffold` before `render()` to seed the transcript, the latched
 * divider anchor, or the queued messages the panel should see.
 */
import { vi } from 'vitest';
import type { AgentMessage } from '$shared/types';

export const scaffold = {
  dispatch: vi.fn(),
  agentMessages: [] as AgentMessage[],
  agentSession: { id: 'agent-1', workspaceId: 'ws-1', status: 'active', messages: [] } as unknown,
  dividerAnchorId: null as string | null,
  queuedMessages: [] as unknown[],
};

export function resetScaffold() {
  scaffold.dispatch.mockReset();
  scaffold.agentMessages = [];
  scaffold.agentSession = { id: 'agent-1', workspaceId: 'ws-1', status: 'active', messages: [] };
  scaffold.dividerAnchorId = null;
  scaffold.queuedMessages = [];
}

function selectorFrom<T>(get: () => T) {
  return Object.assign(
    vi.fn(() => ({ subscribe: (run: (value: T) => void) => (run(get()), () => {}) })),
    { select: vi.fn(get) },
  );
}

/** Module whose every export is a constant-valued selector readable. */
export function stub(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, selectorFrom(() => value)]),
  );
}

export async function appStore() {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ browser: { byWorkspaceId: {} } }),
    dispatch: scaffold.dispatch,
  });
}

export function agentSessionSelectors() {
  return {
    ...stub({
      selectAgentIsResponding: false,
      selectAgentIsRunning: false,
      selectAgentSessionIsStreaming: false,
      selectAgentSessionStreamingContent: '',
      selectAgentHistoryMessages: [],
      selectHistorySegmentMeta: {
        gapToTail: false,
        oldestReached: false,
        historyCount: 0,
        tailCount: 0,
      },
      selectAgentTailCapPruned: false,
    }),
    selectAgentSession: selectorFrom(() => scaffold.agentSession),
    selectAgentMessages: selectorFrom(() => scaffold.agentMessages),
  };
}

export function chatStateSelectors() {
  return stub({
    selectAwaitingSwitchBackSnapshot: false,
    selectChatError: null,
    selectChatFailureCorrelation: undefined,
    selectChatLastChunkTime: null,
    selectChatLiveStreamPhase: null,
    selectChatModelUnavailable: null,
    selectChatQuotaExceeded: null,
    selectChatReceivedFirstChunk: false,
    selectChatStatusEvents: [],
    selectChatStreamingStartTime: null,
    selectFetchingGapFill: false,
    selectFetchingHistorySeek: false,
    selectFetchingOlderHistory: false,
    selectHistoryExhausted: false,
    selectHistorySeekUnsupported: false,
    selectPendingProposalRecovery: undefined,
    selectPendingQuestionRecovery: undefined,
    selectTranscriptHydration: 'settled',
    selectTranscriptHydratedOnce: true,
    selectTranscriptSnapshotMeta: undefined,
  });
}

export function unreadTrackingSelectors() {
  return {
    selectDividerSession: selectorFrom(() =>
      scaffold.dividerAnchorId === null ? null : { anchorId: scaffold.dividerAnchorId },
    ),
  };
}

export function agentQueueSelectors() {
  return { selectAgentQueueMessages: selectorFrom(() => scaffold.queuedMessages) };
}

export function transientUiSelectors() {
  return {
    ...stub({ selectComposerContextItems: [] }),
    selectChatDraft: { select: vi.fn(() => '') },
  };
}

export function providerCatalogSelectors() {
  return {
    ...stub({
      selectEffectiveDefaultProviderId: '',
      selectProviderCatalogLoaded: false,
      selectProviderCatalogEntries: [],
    }),
    selectProviderAuthFailureGuidance: { select: () => null },
    selectProviderDisplayName: { select: (_state: unknown, id: string) => id },
    selectNormalizedProviderId: { select: (_state: unknown, id: string) => id },
  };
}

export function panelLayoutAdapter() {
  return {
    getPanelLayoutManager: () => ({ getPanelIds: () => [], getPanel: () => null }),
  };
}

export function appClient() {
  return {
    appClient: {
      drafts: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue({ ok: true }),
        clear: vi.fn().mockResolvedValue({ ok: true }),
      },
      agents: { retry: vi.fn(), editQueued: vi.fn(), getQueue: vi.fn().mockResolvedValue([]) },
    },
  };
}
