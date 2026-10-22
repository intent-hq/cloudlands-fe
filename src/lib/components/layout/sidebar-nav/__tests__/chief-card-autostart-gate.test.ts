import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
/**
 * Behavioral test for the Chief auto-start provider gate.
 *
 * On a provider-less backend (providers.active unset, no resolvable model)
 * the expanded ChiefCard must NOT dispatch an agent launch — no agent.create,
 * no toast. The skip must not latch, so once a provider becomes configured
 * the auto-start effect retries and fires exactly one launch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import {
  agentCreationFinished,
  createAgentFromConfigRequested,
  setAgentsLoaded,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { hydrateDefaultProvider } from '$store/renderer/slices/model/model-slice';
import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { AgentSession } from '$shared/types';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import ChiefCard from '../cards/ChiefCard.svelte';

vi.mock('$lib/components/chat/ChatPanel.svelte', async () => ({
  default: (await import('./mocks/MockChiefChatPanel.svelte')).default,
}));

describe('ChiefCard auto-start provider gate', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;
  let launchActions: ReturnType<typeof createAgentFromConfigRequested>[];

  beforeEach(() => {
    appStore.init();
    admitLegacyPrincipal();
    appStore.dispatch(hydrateDefaultProvider(''));
    // A settled owner window: the guest session list hydrated with no joined
    // host. The guest-window case below replaces it with a joined host.
    appStore.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
    appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));

    launchActions = [];
    const originalDispatch = appStore.dispatch.bind(appStore);
    dispatchSpy = vi.spyOn(appStore, 'dispatch').mockImplementation((action: any) => {
      if (action?.type === createAgentFromConfigRequested.type) {
        // Exercise the real pending reducer, then acknowledge this consumer
        // like the creation owner without a saga/wire round-trip.
        launchActions.push(action);
        const result = originalDispatch(action);
        const [workspaceId, , { consumer }] = action.payload;
        queueMicrotask(() => {
          originalDispatch(
            agentCreationFinished({
              ...consumer,
              workspaceId,
              seq: action.seq,
              status: 'success',
              agentId: 'agent-chief-gate-test',
              completedAt: '2026-10-01T00:00:00.000Z',
            }),
          );
          originalDispatch(action.success({ id: 'agent-chief-gate-test' } as AgentSession));
        });
        return result;
      }
      return originalDispatch(action);
    });
  });

  afterEach(() => {
    cleanup();
    dispatchSpy.mockRestore();
    appStore.dispatch(hydrateDefaultProvider(''));
  });

  it('skips the launch while provider-less, then fires exactly once when configured', async () => {
    render(ChiefCard, { props: {} });

    // Provider-less: the auto-start effect must skip without dispatching.
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(launchActions).toHaveLength(0);

    // Configure a provider: the ungated effect re-runs and launches once.
    appStore.dispatch(hydrateDefaultProvider('auggie'));
    await waitFor(() => expect(launchActions).toHaveLength(1));

    // The latch is set after the successful gate pass — no duplicate launch.
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(launchActions).toHaveLength(1);
  });

  it('does not auto-start in an inactive tab and starts once when Intent becomes active', async () => {
    appStore.dispatch(hydrateDefaultProvider('auggie'));
    const { rerender } = render(ChiefCard, {
      props: { isActive: false },
    });
    await tick();
    expect(launchActions).toHaveLength(0);

    await rerender({ isActive: true });
    await waitFor(() => expect(launchActions).toHaveLength(1));
    await rerender({ isActive: false });
    await rerender({ isActive: true });
    expect(launchActions).toHaveLength(1);
  });

  it('skips the auto-start and withholds new/delete thread in a guest window', async () => {
    // A guest window: the window's backend is a joined host, so `agent.create`
    // / `agent.delete` are refused (-32003) and the affordances are withheld.
    const host: GuestSessionRecord = {
      id: 'guest-host-1',
      label: 'studio.local',
      host: '10.0.0.5',
      hosts: ['10.0.0.5'],
      port: 8443,
      fingerprint: 'AB:CD',
      tcAddress: null,
      hostname: 'studio',
      principalId: 'principal-1',
      login: 'octocat',
      tokenEncrypted: true,
      workspaces: [],
      updatedAt: 1,
    };
    appStore.dispatch(
      guestSessionsListReceived({ sessions: [host], openIds: [host.id], connectedIds: [host.id] }),
    );
    appStore.dispatch(
      connectionsListReceived({
        connections: [
          {
            id: host.id,
            label: host.label,
            host: host.host,
            port: host.port,
            fingerprint: host.fingerprint,
            isLocal: false,
          },
        ],
        activeId: host.id,
        windowBackendId: host.id,
      }),
    );
    admitLegacyPrincipal('guest');
    appStore.dispatch(hydrateDefaultProvider('auggie'));

    render(ChiefCard, { props: {} });

    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(launchActions).toHaveLength(0);
    expect(
      screen.queryByRole('button', { name: m.layout_chiefCard_newThread_tooltip() }),
    ).toBeNull();
  });
});
