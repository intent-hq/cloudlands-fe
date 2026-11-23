/**
 * @vitest-environment jsdom
 *
 * Retry setup on a remote agent's setup-failed card: shown only with
 * `remoteSetupRetry: 1`, held while the request is in flight and while the
 * retried run goes, which opens its live log.
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { admitLegacyPrincipal, withHostPrincipal } from '../../test/fixtures/principal-state';
import { principalReceived } from '$store/renderer/slices/principal/principal-slice';
import AgentPlacementNotice from './AgentPlacementNotice.svelte';
import {
  remoteMachineOperationSettled,
  remoteMachineOperationStarted,
  remoteMachinesLoaded,
  remoteSetupRetryRequested,
  setupRetryKey,
} from './remote-machines-slice';

let AGENT = 'agent-retry-0';
let agentSeq = 0;
const FAILED = {
  state: 'failed' as const,
  exitCode: 2,
  startedAt: '2026-11-23T09:00:00Z',
  finishedAt: '2026-11-23T09:00:09Z',
  output: 'npm ERR! missing script: bootstrap\n',
};
const session = (setup: AgentSession['setup'], status = AgentStatus.Idle): AgentSession =>
  ({
    id: AgentId(AGENT),
    backendSessionId: null,
    workspaceId: WorkspaceId('ws-1'),
    name: 'iOS build fixer',
    status,
    messages: [],
    createdAt: '2026-11-23T09:00:00Z',
    updatedAt: '2026-11-23T09:00:00Z',
    nodeId: 'node-mac',
    nodeName: 'Mac mini',
    leaseId: 'lease-1',
    placement: { target: 'remote', checkout: 'isolated', os: 'macos', arch: 'aarch64' },
    effectiveIsolation: 'isolated',
    setup,
  }) as AgentSession;

const upsert = (setup: AgentSession['setup'], status = AgentStatus.Idle) =>
  store.dispatch(
    bulkUpsertSessions([session(setup, status)], { preserveExplicitRuntimeFlags: true }),
  );

function seed(
  setup: AgentSession['setup'],
  supported = true,
  role: 'owner' | 'member' = 'owner',
  status = AgentStatus.Idle,
) {
  admitLegacyPrincipal('owner', supported ? { remoteSetupRetry: 1 } : {});
  // A host with membership: a member is admitted but does not own the host.
  if (role === 'member') {
    const snapshot = withHostPrincipal(store.state, 'member').principal.snapshot!;
    store.dispatch(
      principalReceived(
        {
          context: store.state.principal.context!,
          invalidation: store.state.principal.invalidation,
          presentationVersion: 0,
        },
        { ...snapshot, capabilities: { ...snapshot.capabilities, remoteSetupRetry: 1 } },
      ),
    );
  }
  store.dispatch(
    remoteMachinesLoaded({
      supported: true,
      machines: [],
      localFingerprint: null,
      executorBackends: null,
    }),
  );
  upsert(setup, status);
}

const notice = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-agent-placement-notice]');
const retryButton = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>('[data-setup-retry]');

beforeEach(() => {
  AGENT = `agent-retry-${++agentSeq}`;
  store.init();
  store.dispatch(backendReconnected());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Retry setup on the setup-failed card', () => {
  it('is absent when the backend does not advertise remoteSetupRetry', () => {
    seed(FAILED, false);
    const { container } = render(AgentPlacementNotice, { agentId: AGENT });
    expect(notice(container)?.dataset.agentPlacementNotice).toBe('setup-failed');
    expect(retryButton(container)).toBeNull();
  });

  it('requests a retry for this agent, then holds while in flight and while the run goes', async () => {
    seed(FAILED);
    const dispatch = vi.spyOn(store, 'dispatch');
    const requests = () =>
      dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => (action as { type?: string }).type === remoteSetupRetryRequested.type);
    const { container, getByRole } = render(AgentPlacementNotice, { agentId: AGENT });
    expect(retryButton(container)?.disabled).toBe(false);

    await fireEvent.click(retryButton(container)!);
    expect(requests().map((action) => action.payload)).toEqual([
      [{ workspaceId: 'ws-1', agentId: AGENT, machine: 'Mac mini' }],
    ]);

    // The saga marks the request in flight: the button holds and a press sends nothing.
    store.dispatch(remoteMachineOperationStarted(setupRetryKey(AGENT), 'retrying-setup'));
    await waitFor(() => expect(retryButton(container)?.disabled).toBe(true));
    dispatch.mockClear();
    await fireEvent.click(retryButton(container)!);
    expect(requests()).toHaveLength(0);

    // `agent:updated` moves setup to the retried run; its output starts over.
    upsert({ state: 'running', startedAt: '2026-11-23T09:05:00Z', output: '$ make bootstrap\n' });
    store.dispatch(remoteMachineOperationSettled(setupRetryKey(AGENT), null));
    await waitFor(() =>
      expect(notice(container)?.dataset.agentPlacementNotice).toBe('setup-running'),
    );
    expect(retryButton(container)?.disabled).toBe(true);
    await waitFor(() => expect(getByRole('log').textContent).toContain('$ make bootstrap'));
    expect(getByRole('log').textContent).not.toContain('missing script');

    // The run fails again: the button is back.
    upsert({ ...FAILED, startedAt: '2026-11-23T09:05:00Z' });
    await waitFor(() =>
      expect(notice(container)?.dataset.agentPlacementNotice).toBe('setup-failed'),
    );
    expect(retryButton(container)?.disabled).toBe(false);
  });

  it('is absent for a member: agent.retrySetup is for the host owner', () => {
    seed(FAILED, true, 'member');
    const { container } = render(AgentPlacementNotice, { agentId: AGENT });
    expect(notice(container)?.dataset.agentPlacementNotice).toBe('setup-failed');
    expect(retryButton(container)).toBeNull();
  });

  it('is disabled while the agent runs a turn, and enabled once it is idle', async () => {
    seed(FAILED, true, 'owner', AgentStatus.Processing);
    const { container } = render(AgentPlacementNotice, { agentId: AGENT });
    expect(retryButton(container)?.disabled).toBe(true);
    upsert(FAILED, AgentStatus.Idle);
    await waitFor(() => expect(retryButton(container)?.disabled).toBe(false));
  });
});
