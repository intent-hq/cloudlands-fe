import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';
import {
  createMarkAgentSeen,
  MARK_AGENT_SEEN_DEBOUNCE_MS,
  type MarkAgentSeenState,
} from './mark-agent-seen-factory';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function fixture(messages: AgentMessage[] = [{ id: 'reply', role: 'assistant' } as AgentMessage]) {
  const state: MarkAgentSeenState = {
    unreadTracking: { currentlyViewedAgentId: 'agent' },
    agentSessions: { byAgentId: { agent: { workspaceId: 'workspace', messages } } },
  };
  const markSeen = vi.fn(async () => ({ success: true }));
  const seams = { getState: () => state, markSeen };
  return { state, markSeen, seams };
}
const fire = () => vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS);

it('disposal cancels pending timers and allows a fresh lifetime', async () => {
  const { seams, markSeen } = fixture();
  const marker = createMarkAgentSeen({ loadSeams: async () => seams });
  marker.markAgentSeenOnView('agent');
  marker.dispose();
  await fire();
  expect(markSeen).not.toHaveBeenCalled();
  marker.markAgentSeenOnView('agent');
  await fire();
  expect(markSeen).toHaveBeenCalledTimes(1);
  marker.dispose();
  marker.markAgentSeenOnView('agent');
  await fire();
  expect(markSeen).toHaveBeenCalledTimes(2);
  marker.dispose();
});

it('disposal releases empty-transcript rearms', async () => {
  const { seams, state, markSeen } = fixture([]);
  const marker = createMarkAgentSeen({ loadSeams: async () => seams });
  marker.markAgentSeenOnView('agent');
  await fire();
  marker.dispose();
  state.agentSessions!.byAgentId.agent!.messages = [
    { id: 'reply', role: 'assistant' } as AgentMessage,
  ];
  marker.markAgentSeenOnTranscriptHydrated('agent');
  await fire();
  expect(markSeen).not.toHaveBeenCalled();
});

it('disposal fences a boundary waiting for its transport binding', async () => {
  const { seams, markSeen } = fixture();
  let resolve!: (value: typeof seams) => void;
  const marker = createMarkAgentSeen({
    loadSeams: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  marker.markAgentSeenAtBoundary(['agent']);
  marker.dispose();
  resolve(seams);
  await fire();
  expect(markSeen).not.toHaveBeenCalled();
});

it('keeps the original trigger ownership through debounce and empty-transcript rearm', async () => {
  const { seams, state, markSeen } = fixture([]);
  let owner = 'first';
  const marker = createMarkAgentSeen({
    loadSeams: async () => seams,
    captureOwnership: () => {
      const captured = owner;
      return { key: captured, isCurrent: () => captured === owner };
    },
  });
  marker.markAgentSeenOnView('agent');
  await fire();
  state.agentSessions!.byAgentId.agent!.messages = [
    { id: 'reply', role: 'assistant' } as AgentMessage,
  ];
  owner = 'second';
  marker.markAgentSeenOnTranscriptHydrated('agent');
  await fire();
  expect(markSeen).not.toHaveBeenCalled();
  marker.markAgentSeenOnUserSend('agent');
  owner = 'third';
  await fire();
  expect(markSeen).not.toHaveBeenCalled();
  marker.markAgentSeenOnView('agent');
  await fire();
  expect(markSeen).toHaveBeenCalledTimes(1);
  owner = 'fourth';
  marker.markAgentSeenOnView('agent');
  await fire();
  expect(markSeen).toHaveBeenCalledTimes(2);
  marker.dispose();
});

it('does not schedule a marker without optional admission', async () => {
  const { seams, markSeen } = fixture();
  const marker = createMarkAgentSeen({
    loadSeams: async () => seams,
    captureOwnership: () => null,
  });
  marker.markAgentSeenOnView('agent');
  marker.markAgentSeenOnUserSend('agent');
  marker.markAgentSeenAtBoundary(['agent']);
  await fire();
  expect(markSeen).not.toHaveBeenCalled();
  marker.dispose();
});
