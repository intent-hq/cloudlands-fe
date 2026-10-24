/**
 * Selector-module stand-ins for rendering ChatPanel against a mocked store.
 *
 * Each exported factory returns one module shape; the test file registers it
 * with `vi.mock(path, async () => (await import('./mocks/chat-panel-render-scaffold')).x())`.
 * For reactive selectors, spread the factory first and override only that selector:
 * `return { ...agentSessionSelectors(), selectAgentMessages: () => messages };`.
 * Every other selector module starts from the real module and overrides only
 * what the test cares about, so a selector ChatPanel starts reading later still
 * resolves (cloudlands-fe#3525):
 * `vi.mock(path, async (importOriginal) => (await import(scaffold)).withReal(importOriginal, { selectX: value }))`
 * for constant values, or `withRealSelectors(importOriginal, { selectX: liveSelector })`.
 * Real selectors read the mocked store, so a test with its own `$store/renderer/store`
 * mock spreads `chatPanelSliceState()` into that state first; `appStore()` already does.
 * `intent/no-copied-chat-panel-selector-mocks` enforces this in tests importing the
 * real ChatPanel.
 * Call `resetScaffold()` in `beforeEach` to isolate tests.
 * Mutate `scaffold` before `render()` to seed the transcript, the latched
 * divider anchor, or the queued messages the panel should see.
 */
import { vi } from 'vitest';
import { readable, type Readable } from 'svelte/store';
import type { AgentMessage } from '$shared/types';
import { reducers } from '$store/renderer/reducer';

const queueMutationSubscribers = new Set<(value: unknown[]) => void>();

export const scaffold = {
  dispatch: vi.fn(),
  authorityState: {} as object,
  agentMessages: [] as AgentMessage[],
  agentSession: { id: 'agent-1', workspaceId: 'ws-1', status: 'active', messages: [] } as unknown,
  dividerAnchorId: null as string | null,
  queuedMessages: [] as unknown[],
  queueMutations: [] as unknown[],
};

export function resetScaffold() {
  sliceState = undefined;
  scaffold.dispatch.mockReset();
  scaffold.authorityState = {};
  scaffold.agentMessages = [];
  scaffold.agentSession = { id: 'agent-1', workspaceId: 'ws-1', status: 'active', messages: [] };
  scaffold.dividerAnchorId = null;
  scaffold.queuedMessages = [];
  scaffold.queueMutations = [];
  queueMutationSubscribers.clear();
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

/**
 * The real selector module with only `values` replaced by constant-valued
 * selectors. Pass the `importOriginal` argument of the `vi.mock` factory.
 */
export async function withReal(
  importOriginal: () => Promise<unknown>,
  values: Record<string, unknown> = {},
) {
  return withRealSelectors(importOriginal, stub(values));
}

/** The real selector module with only `selectors` replaced, as given. */
export async function withRealSelectors(
  importOriginal: () => Promise<unknown>,
  selectors: Record<string, unknown>,
) {
  return { ...((await importOriginal()) as Record<string, unknown>), ...selectors };
}

let sliceState: Record<string, unknown> | undefined;

/**
 * The real initial state of every root reducer slice, so a real selector the
 * test does not override reads real defaults instead of throwing on a missing
 * slice. Built once per `resetScaffold()` from a copy, so a test that mutates it
 * in place cannot leak into the shared reducer defaults. Spread it first; test
 * keys win.
 */
export function chatPanelSliceState() {
  sliceState ??= structuredClone(
    Object.fromEntries(
      Object.entries(reducers).map(([slice, reducer]) => [slice, reducer.initialState]),
    ),
  );
  return sliceState;
}

export async function appStore() {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      ...chatPanelSliceState(),
      ...scaffold.authorityState,
    }),
    dispatch: (action) => {
      scaffold.dispatch(action);
      if (action?.type === 'agentQueue/mutationRequested') {
        const request = action.payload[0];
        const { operation, ...identity } = request;
        scaffold.queueMutations = [
          {
            ...identity,
            kind: operation.kind,
            ...(operation.kind === 'edit' && operation.editing !== undefined
              ? { editing: operation.editing }
              : {}),
            status: 'succeeded',
          },
        ];
        for (const run of queueMutationSubscribers) run(scaffold.queueMutations);
      }
      return action;
    },
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
    selectChatLastAttemptedMessage: null,
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
    selectInitialChatHistory: undefined,
    selectInitialChatHistoryPending: false,
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
  return {
    selectAgentQueueMessages: selectorFrom(() => scaffold.queuedMessages),
    selectQueuedMessageMutations: Object.assign(
      vi.fn(() => ({
        subscribe: (run: (value: unknown[]) => void) => {
          run(scaffold.queueMutations);
          queueMutationSubscribers.add(run);
          return () => queueMutationSubscribers.delete(run);
        },
      })),
      { select: vi.fn(() => scaffold.queueMutations) },
    ),
  };
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
      selectProviderCatalogProfiles: [],
    }),
    selectProviderAuthFailureGuidance: { select: () => null },
    selectProviderDisplayName: Object.assign(
      (id: string | Readable<string>) => (typeof id === 'string' ? readable(id) : id),
      { select: (_state: unknown, id: string) => id },
    ),
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
