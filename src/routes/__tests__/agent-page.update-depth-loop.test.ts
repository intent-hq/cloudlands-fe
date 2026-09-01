/**
 * Regression coverage for intent-hq/intent#4008: mounting the dedicated-agent
 * route with a live session in the store must not enter a Svelte effect update
 * loop (`effect_update_depth_exceeded`). The subscription effect used to track
 * the `agent` $state it also wrote via the synchronous subscribeToAgent
 * callback — each rewrite wraps the session in a fresh proxy, so the effect
 * re-ran and resubscribed forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

vi.mock('$app/state', () => ({
  page: {
    params: { id: 'agent-loop-1' },
    url: new URL('http://localhost/agent/agent-loop-1'),
    route: { id: '/(app)/agent/[id]' },
  },
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/components/chat/input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/chat/MessageContent.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));

import { store as appStore } from '$store/renderer/store';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentSession } from '$shared/types';
import Page from '../(app)/agent/[id]/+page.svelte';

const AGENT_ID = 'agent-loop-1';

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AGENT_ID,
    backendSessionId: null,
    workspaceId: 'workspace-1',
    name: 'Loop Agent',
    status: AgentStatus.Active,
    messages: [
      {
        id: 'msg-1',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'hello from the agent' }],
        timestamp: '2026-08-30T00:00:00.000Z',
      },
    ],
    ...overrides,
  } as AgentSession;
}

describe('agent/[id] +page.svelte update-depth regression (intent#4008)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    appStore.init();
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
    vi.unstubAllGlobals();
  });

  it('mounts without effect_update_depth_exceeded when the session is already in the store', () => {
    appStore.dispatch(bulkUpsertSessions([makeSession()]));

    expect(() => {
      render(Page);
      flushSync();
    }).not.toThrow();

    // Transcript rendered from the seeded session (one MessageContent stub).
    expect(screen.getAllByTestId('generic-marker').length).toBeGreaterThan(0);
  });

  it('stays stable when the store publishes an updated session after mount', () => {
    appStore.dispatch(bulkUpsertSessions([makeSession()]));
    render(Page);
    flushSync();

    expect(() => {
      appStore.dispatch(
        bulkUpsertSessions([
          makeSession({
            messages: [
              {
                id: 'msg-1',
                role: 'assistant',
                contentBlocks: [{ type: 'text', text: 'hello from the agent' }],
                timestamp: '2026-08-30T00:00:00.000Z',
              },
              {
                id: 'msg-2',
                role: 'user',
                contentBlocks: [{ type: 'text', text: 'follow-up' }],
                timestamp: '2026-08-30T00:00:01.000Z',
              },
            ],
          }),
        ]),
      );
      flushSync();
    }).not.toThrow();

    // Both transcript rows render (2 MessageContent stubs + input stub).
    expect(screen.getAllByTestId('generic-marker').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the fallback view without looping when the agent is missing from the store', () => {
    expect(() => {
      render(Page);
      flushSync();
    }).not.toThrow();

    // No transcript rows; the page still mounts (input stub present).
    expect(screen.getAllByTestId('generic-marker').length).toBeGreaterThan(0);
  });
});
