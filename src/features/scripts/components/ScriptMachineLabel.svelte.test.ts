/**
 * @vitest-environment jsdom
 *
 * A remote agent's machine run names the machine it runs on: the machine's
 * `remoteMachines.list` row first, else the remote agent's own machine name.
 */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { remoteMachinesLoaded } from '$features/remote-machines/remote-machines-slice';
import ScriptMachineLabel from './ScriptMachineLabel.svelte';

const RUN = { remoteAgentId: 'agent-remote', nodeId: 'node-mac' };

const agent = {
  id: AgentId('agent-remote'),
  backendSessionId: null,
  workspaceId: WorkspaceId('ws-1'),
  name: 'Remote worker',
  status: AgentStatus.Idle,
  messages: [],
  createdAt: '2026-11-03T08:00:00Z',
  updatedAt: '2026-11-03T08:00:00Z',
  nodeId: 'node-mac',
  nodeName: 'Mac Studio',
  placement: { target: 'remote', checkout: 'isolated', os: 'macos', arch: 'aarch64' },
} as unknown as AgentSession;

const machine = (state: RemoteMachine['state']): RemoteMachine => ({
  id: 'node-mac',
  name: 'Studio (listed)',
  hosts: [],
  port: 7443,
  fingerprint: 'fp',
  state,
  runningAgents: 1,
  addedAt: '2026-11-01T00:00:00Z',
});

beforeEach(() => {
  store.init();
  store.dispatch(backendReconnected());
  store.dispatch(bulkUpsertSessions([agent], { preserveExplicitRuntimeFlags: true }));
});
afterEach(() => cleanup());

describe('ScriptMachineLabel', () => {
  it("names the remote agent's machine in the label variant", () => {
    const { container } = render(ScriptMachineLabel, { run: RUN, variant: 'label' });
    const el = container.querySelector<HTMLElement>('[data-script-machine="label"]')!;
    expect(el.textContent?.trim()).toBe('On Mac Studio');
    expect(el.getAttribute('title')).toBe('Runs on Mac Studio · macOS arm64');
  });

  it('prefers the listed machine row and names its state in the icon variant', () => {
    store.dispatch(
      remoteMachinesLoaded({
        supported: true,
        machines: [machine('unreachable')],
        localFingerprint: null,
        executorBackends: null,
      }),
    );
    const { container } = render(ScriptMachineLabel, { run: RUN, variant: 'icon' });
    const badge = container.querySelector('[data-agent-machine-badge="icon"]');
    expect(badge?.getAttribute('aria-label')).toBe('Runs on Studio (listed) · Unreachable');
    expect(badge?.getAttribute('data-agent-machine-state')).toBe('unreachable');
  });
});
