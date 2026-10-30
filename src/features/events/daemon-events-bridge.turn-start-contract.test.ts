// @vitest-environment node
// @verify-changed-triggers: scripts/turn-start-fixtures.mjs, tests/fixtures/turn-start-events.json, tests/fixtures/turn-start-events.lock.json
/**
 * Every daemon event the protocol names as the start of an agent turn (monorepo
 * docs/protocol/06-events.md §6.6 "Turn-start signals") must make an idle agent
 * read as running, through the right mechanism for its turn kind.
 *
 * The events are an exact-byte copy of the monorepo's turn-start fixture under
 * tests/fixtures/; CI verifies the copy against the monorepo commit named in
 * turn-start-events.lock.json. A turn-start event added there fails here until
 * the bridge handles it, which is how the queued-message Thinking-indicator
 * delay (cloudlands-fe#3849, `agent:queue:processing` ignored) would have been
 * caught.
 *
 * Mechanisms (the first #3849 attempt used the wrong one):
 * - `agent-initiated` (harness-wake): no send exists, so the bridge opens the
 *   turn itself: an in-flight assistant message under `data.messageId`.
 * - `prompt` / `any`: daemon-owned liveness only, the sticky `liveTurnOpen`
 *   stamped with the event's own timestamp. The send path's Thinking timer
 *   (`streamingStartTime`, started by `chatSendStarted`) must stay unset:
 *   checked on the resulting chat state, so a saga that started it would fail
 *   too.
 *
 * Runs the production bridge against the real store with every daemon request
 * withheld.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
  backendRequest: () => new Promise(() => {}),
}));

import { store as appStore } from '$store/renderer/store';
import { agentStreamSaga } from '$store/renderer/slices/agent-session/sagas/agent-stream-saga';
import {
  bulkUpsertSessions,
  clearAllSessions,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectAgentIsResponding } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { chatReset } from '$store/renderer/slices/chat-state/chat-state-slice';
import {
  clearAllStandingChatSubscriptions,
  markStandingChatSubscription,
} from '$features/agent/utils/chat-subscription-registry';
import {
  __resetDaemonEventsBridgeForTests,
  routeDaemonEventsNotification,
} from './daemon-events-bridge.client';
import { loadTurnStartEvents } from '../../../scripts/turn-start-fixtures.mjs';

type TurnKind = 'agent-initiated' | 'prompt' | 'any';

interface TurnStartEntry {
  id: string;
  type: string;
  turn: TurnKind;
  match?: Record<string, unknown>;
  event: {
    type: string;
    workspaceId: string;
    id: string;
    timestamp: string;
    actor: Record<string, unknown>;
    data: { agentId: string; messageId?: string } & Record<string, unknown>;
  };
}

const { events } = (await loadTurnStartEvents()) as { events: TurnStartEntry[] };

/** How the bridge must open each §6.6 turn kind. An unmapped kind fails the guard below. */
const MECHANISM: Record<TurnKind, 'wake-placeholder' | 'daemon-liveness'> = {
  'agent-initiated': 'wake-placeholder',
  prompt: 'daemon-liveness',
  any: 'daemon-liveness',
};

const agentIds = [...new Set(events.map((entry) => entry.event.data.agentId))];

function seedIdleSession(entry: TurnStartEntry): void {
  const { agentId } = entry.event.data;
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        workspaceId: entry.event.workspaceId,
        backendSessionId: `backend-${agentId}`,
        name: 'Turn start',
        status: AgentStatus.RuntimeIdle,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        messages: [],
        createdAt: '2026-10-30T11:00:00.000Z',
        updatedAt: '2026-10-30T11:00:00.000Z',
      } as unknown as AgentSession,
    ]),
  );
  markStandingChatSubscription(agentId);
}

const session = (agentId: string) => appStore.state.agentSessions?.byAgentId[agentId];

/** The send path's Thinking timer, which `chatSendStarted` starts. */
const thinkingTimerStarted = (agentId: string) =>
  typeof appStore.state.chatState?.byAgentId[agentId]?.streamingStartTime === 'number';

describe('protocol turn-start events (docs/protocol/06-events.md §6.6)', () => {
  let stopStreamSaga: () => void = () => {};

  beforeAll(() => {
    appStore.init();
    // Builds the in-flight assistant placeholder from the bridge's stream updates.
    stopStreamSaga = appStore.runSaga(agentStreamSaga);
  });
  beforeEach(() => __resetDaemonEventsBridgeForTests());
  afterEach(() => {
    for (const agentId of agentIds) appStore.dispatch(chatReset(agentId));
    appStore.dispatch(clearAllSessions());
    clearAllStandingChatSubscriptions();
  });
  afterAll(() => {
    stopStreamSaga();
    appStore.dispose();
  });

  it('replays a non-empty fixture whose every turn kind has a mechanism', () => {
    expect(events.length).toBeGreaterThan(0);
    for (const entry of events) {
      expect(MECHANISM, `${entry.id}: unmapped turn kind ${entry.turn}`).toHaveProperty(entry.turn);
    }
  });

  it.each(events.map((entry) => [entry.id, entry] as const))(
    '%s makes an idle agent read as running',
    (_id, entry) => {
      const { agentId } = entry.event.data;
      seedIdleSession(entry);
      expect(MECHANISM[entry.turn], `unmapped turn kind ${entry.turn}`).toBeDefined();
      expect(selectAgentIsResponding.select(appStore.state, agentId)).toBe(false);
      expect(thinkingTimerStarted(agentId)).toBe(false);

      routeDaemonEventsNotification('events.event', { event: structuredClone(entry.event) });

      expect(selectAgentIsResponding.select(appStore.state, agentId)).toBe(true);
      const stored = session(agentId);
      if (MECHANISM[entry.turn] === 'wake-placeholder') {
        const placeholder = stored?.messages?.find((m) => m.id === entry.event.data.messageId);
        expect(placeholder?.role).toBe('assistant');
        expect(placeholder?.isStreaming).toBe(true);
        expect((stored?.messages ?? []).filter((m) => m.role === 'user')).toEqual([]);
        // A wake turn has no send, so the bridge opens the send-path UI itself.
        // This also shows the timer check sees what the other kinds must not do.
        expect(thinkingTimerStarted(agentId)).toBe(true);
      } else {
        expect(stored?.liveTurnOpen).toBe(true);
        expect(stored?.liveTurnOpenedAt).toBe(entry.event.timestamp);
        expect(thinkingTimerStarted(agentId), 'the Thinking timer belongs to the send path').toBe(
          false,
        );
      }
    },
  );
});
