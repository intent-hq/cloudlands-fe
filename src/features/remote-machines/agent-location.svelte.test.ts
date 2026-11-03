/**
 * @vitest-environment jsdom
 *
 * Where a remote agent runs: the agent-row machine badge and the conversation
 * notices.
 * Badges describe existing work, so they show with the Labs flag off; the
 * machine list (flag on) adds "access revoked" and the "Check again" action.
 */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import AgentLocationBadge from './AgentLocationBadge.svelte';
import AgentPlacementNotice from './AgentPlacementNotice.svelte';
import { remoteMachinesLoaded } from './remote-machines-slice';

const navigation = vi.hoisted(() => ({ navigateToSettings: vi.fn(async () => {}) }));
vi.mock('$lib/utils/workspace-navigation', () => navigation);

// A fresh id per test: node fields (placementError included) deliberately
// survive upserts of the same agent that omit them.
let AGENT = 'agent-remote-0';
let agentSeq = 0;
const session = (extra: Partial<AgentSession> = {}): AgentSession =>
  ({
    id: AgentId(AGENT),
    backendSessionId: null,
    workspaceId: WorkspaceId('ws-1'),
    name: 'iOS build fixer',
    status: AgentStatus.Idle,
    messages: [],
    createdAt: '2026-11-02T08:00:00Z',
    updatedAt: '2026-11-02T08:00:00Z',
    nodeId: 'node-mac',
    nodeName: 'Mac mini',
    leaseId: 'lease-1',
    placement: { target: 'remote', checkout: 'isolated', os: 'macos', arch: 'aarch64' },
    effectiveIsolation: 'isolated',
    ...extra,
  }) as AgentSession;

const machine = (state: RemoteMachine['state']): RemoteMachine => ({
  id: 'node-mac',
  name: 'Mac mini',
  hosts: [],
  port: 7443,
  fingerprint: 'fp',
  state,
  runningAgents: 1,
  addedAt: '2026-11-01T00:00:00Z',
});

function seed(agent: AgentSession, opts: { labs?: boolean; machine?: RemoteMachine } = {}) {
  store.dispatch(setLabsRemoteAgentsEnabled(opts.labs ?? false));
  store.dispatch(
    remoteMachinesLoaded({
      supported: true,
      machines: opts.machine ? [opts.machine] : [],
      localFingerprint: null,
      executorBackends: null,
    }),
  );
  store.dispatch(bulkUpsertSessions([agent], { preserveExplicitRuntimeFlags: true }));
}

const notice = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-agent-placement-notice]');

beforeEach(() => {
  AGENT = `agent-remote-${++agentSeq}`;
  store.init();
  store.dispatch(backendReconnected());
  navigation.navigateToSettings.mockClear();
});
afterEach(() => cleanup());

describe('agent row machine badge', () => {
  it('names the machine for a remote agent with the Labs flag off', () => {
    seed(session());
    const { container } = render(AgentLocationBadge, { agentId: AGENT });
    const badge = container.querySelector('[data-agent-machine-badge="icon"]');
    expect(badge?.getAttribute('aria-label')).toBe('Runs on Mac mini · macOS arm64');
  });

  it('adds no nested control inside the row button', () => {
    seed(session());
    const { container } = render(AgentLocationBadge, { agentId: AGENT });
    const badge = container.querySelector<HTMLElement>('[data-agent-machine-badge]');
    expect(badge?.getAttribute('title')).toBe('Runs on Mac mini · macOS arm64');
    expect(container.querySelector('[role="button"], [tabindex], button')).toBeNull();
  });

  it('renders nothing for a local agent', () => {
    seed(session({ placement: undefined, nodeId: undefined, nodeName: undefined }));
    const { container } = render(AgentLocationBadge, { agentId: AGENT });
    expect(container.querySelector('[data-agent-machine-badge]')).toBeNull();
  });

  it('marks access revoked from the machine list', () => {
    seed(session(), { labs: true, machine: machine('revoked') });
    const { container } = render(AgentLocationBadge, { agentId: AGENT });
    const badge = container.querySelector('[data-agent-machine-badge]');
    expect(badge?.getAttribute('data-agent-machine-state')).toBe('revoked');
    expect(badge?.getAttribute('aria-label')).toContain('Access revoked');
  });
});

describe('agent placement notice', () => {
  it('shows nothing while a remote agent runs normally', () => {
    seed(session());
    const { container } = render(AgentPlacementNotice, { agentId: AGENT });
    expect(notice(container)).toBeNull();
  });

  it('says the agent is starting on its machine', () => {
    seed(session({ effectiveIsolation: 'pending' }));
    const { container } = render(AgentPlacementNotice, { agentId: AGENT });
    expect(notice(container)?.dataset.agentPlacementNotice).toBe('starting');
    expect(notice(container)?.textContent).toContain('Starting on Mac mini…');
  });

  it('shows the placement error and says to start a new agent (no retry offered)', async () => {
    seed(
      session({
        placementError: {
          code: 'remote-launch-failed',
          detail: 'node-provider-unavailable: Claude Code is signed out',
        },
      }),
    );
    const { container, getByRole, queryByRole } = render(AgentPlacementNotice, {
      agentId: AGENT,
    });
    const text = notice(container)?.textContent ?? '';
    expect(text).toContain("Couldn't start on Mac mini");
    expect(text).toContain('Claude Code is signed out');
    expect(text).toContain('Start a new agent to try again.');
    expect(queryByRole('button', { name: /try again/i })).toBeNull();
    await fireEvent.click(getByRole('button', { name: 'Open Devices settings' }));
    expect(navigation.navigateToSettings).toHaveBeenCalledWith({
      tab: 'devices',
      hash: 'devices',
    });
  });

  it('says a message sent while the machine is unreachable fails after a wait', () => {
    seed(session({ nodeState: 'offline' }));
    const { container, queryByRole } = render(AgentPlacementNotice, { agentId: AGENT });
    const text = notice(container)?.textContent ?? '';
    expect(text).toContain("Mac mini can't be reached");
    expect(text).toContain('waits about a minute for Mac mini, then fails');
    // "Check again" refreshes the machine list, which needs the Labs flag.
    expect(queryByRole('button', { name: 'Check again' })).toBeNull();
  });

  it('offers Check again with the Labs flag on and refreshes the machine list', async () => {
    seed(session(), { labs: true, machine: machine('unreachable') });
    const dispatch = vi.spyOn(store, 'dispatch');
    const { getByRole } = render(AgentPlacementNotice, { agentId: AGENT });
    await fireEvent.click(getByRole('button', { name: 'Check again' }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'remoteMachines/refreshRequested' }),
    );
    dispatch.mockRestore();
  });

  it('says the machine revoked access', () => {
    seed(session(), { labs: true, machine: machine('revoked') });
    const { container } = render(AgentPlacementNotice, { agentId: AGENT });
    expect(notice(container)?.dataset.agentPlacementNotice).toBe('revoked');
    expect(notice(container)?.textContent).toContain('Mac mini revoked access');
  });
});
