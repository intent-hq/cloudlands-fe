import { describe, expect, it } from 'vitest';
import type { AgentSession } from '$shared/types';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { agentNodeUpdates } from '$shared/utils/agent-node';
import { getAgentNodeStatusLabel } from '$lib/components/chat/agent-node-status-label';
import {
  agentMachineLocation,
  agentPlacementNoticeKind,
  machineLocation,
  machinePlatformLabel,
} from './agent-location';

const remoteAgent = (extra: Partial<AgentSession> = {}): AgentSession =>
  ({
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'iOS build fixer',
    status: 'idle',
    messages: [],
    nodeId: 'node-mac',
    nodeName: 'Mac mini',
    placement: { target: 'remote', checkout: 'isolated', os: 'macos', arch: 'aarch64' },
    effectiveIsolation: 'isolated',
    ...extra,
  }) as unknown as AgentSession;

const machine = (extra: Partial<RemoteMachine> = {}): RemoteMachine => ({
  id: 'node-mac',
  name: 'Mac mini (list)',
  platform: { os: 'macos', arch: 'aarch64' },
  hosts: [],
  port: 7443,
  fingerprint: 'fp',
  state: 'connected',
  runningAgents: 1,
  addedAt: '2026-11-01T00:00:00Z',
  ...extra,
});

describe('agent node fields', () => {
  it('parses nodeName from the wire', () => {
    expect(agentNodeUpdates({ nodeId: 'node-mac', nodeName: 'Mac mini' }).nodeName).toBe(
      'Mac mini',
    );
  });
});

describe('agentMachineLocation', () => {
  it('is null for a local agent', () => {
    expect(agentMachineLocation(remoteAgent({ placement: undefined, nodeId: undefined }))).toBe(
      null,
    );
    expect(
      agentMachineLocation(
        remoteAgent({ placement: { target: 'local', checkout: 'worktree' }, nodeId: undefined }),
      ),
    ).toBe(null);
  });

  it('names the machine and platform from the agent alone (Labs flag off)', () => {
    expect(agentMachineLocation(remoteAgent())).toEqual({
      nodeId: 'node-mac',
      name: 'Mac mini',
      platform: 'macOS arm64',
      state: 'ready',
    });
  });

  it('prefers the agent nodeName and fills the platform from the machine list', () => {
    const location = agentMachineLocation(
      remoteAgent({ placement: { target: 'remote', checkout: 'isolated' } }),
      machine({ platform: { os: 'linux', arch: 'x86_64' } }),
    );
    expect(location?.name).toBe('Mac mini');
    expect(location?.platform).toBe('Linux x64');
  });

  it('falls back to the machine list name, then a neutral name', () => {
    expect(agentMachineLocation(remoteAgent({ nodeName: undefined }), machine())?.name).toBe(
      'Mac mini (list)',
    );
    expect(agentMachineLocation(remoteAgent({ nodeName: undefined }))?.name).toBe(
      'Another machine',
    );
  });

  it('reports unreachable from the agent nodeState or the machine state', () => {
    expect(agentMachineLocation(remoteAgent({ nodeState: 'offline' }))?.state).toBe('unreachable');
    expect(agentMachineLocation(remoteAgent(), machine({ state: 'unreachable' }))?.state).toBe(
      'unreachable',
    );
  });

  it('derives access revoked only from the machine list, matched on nodeId', () => {
    expect(
      agentMachineLocation(remoteAgent({ nodeState: 'offline' }), machine({ state: 'revoked' }))
        ?.state,
    ).toBe('revoked');
    expect(
      agentMachineLocation(remoteAgent(), machine({ id: 'other', state: 'revoked' }))?.state,
    ).toBe('ready');
  });
});

describe('machinePlatformLabel', () => {
  it('uses product names and short architecture names', () => {
    expect(machinePlatformLabel('macos', 'aarch64')).toBe('macOS arm64');
    expect(machinePlatformLabel('linux', 'x86_64')).toBe('Linux x64');
    expect(machinePlatformLabel('linux', undefined)).toBe('Linux');
    expect(machinePlatformLabel(undefined, undefined)).toBe(null);
  });
});

describe('agentPlacementNoticeKind', () => {
  it('is null for a running remote agent and for local agents', () => {
    const agent = remoteAgent();
    expect(agentPlacementNoticeKind(agent, agentMachineLocation(agent))).toBe(null);
    expect(agentPlacementNoticeKind(remoteAgent({ placement: undefined }), null)).toBe(null);
  });

  it('orders failed, revoked, unreachable, starting', () => {
    const failed = remoteAgent({
      placementError: { code: 'remote-launch-failed', detail: 'x' },
      effectiveIsolation: 'pending',
      nodeState: 'offline',
    });
    expect(agentPlacementNoticeKind(failed, agentMachineLocation(failed))).toBe('failed');
    const revoked = remoteAgent({ effectiveIsolation: 'pending' });
    expect(
      agentPlacementNoticeKind(
        revoked,
        agentMachineLocation(revoked, machine({ state: 'revoked' })),
      ),
    ).toBe('revoked');
    const offline = remoteAgent({ nodeState: 'offline', effectiveIsolation: 'pending' });
    expect(agentPlacementNoticeKind(offline, agentMachineLocation(offline))).toBe('unreachable');
    const starting = remoteAgent({ effectiveIsolation: 'pending' });
    expect(agentPlacementNoticeKind(starting, agentMachineLocation(starting))).toBe('starting');
  });
});

describe('agent row status label', () => {
  it('uses plain words for a remote agent that is starting or could not start', () => {
    expect(getAgentNodeStatusLabel(remoteAgent({ effectiveIsolation: 'pending' }))).toBe(
      'Starting…',
    );
    expect(
      getAgentNodeStatusLabel(
        remoteAgent({ placementError: { code: 'remote-launch-failed', detail: 'x' } }),
      ),
    ).toBe("Couldn't start");
  });

  it('keeps Provisioning for a local placement that is pending', () => {
    expect(
      getAgentNodeStatusLabel(
        remoteAgent({
          placement: { target: 'local', checkout: 'isolated' },
          nodeId: undefined,
          effectiveIsolation: 'pending',
        }),
      ),
    ).toBe('Provisioning');
  });
});

describe('machineLocation (an agent not created yet)', () => {
  it('describes the chosen machine from its list row', () => {
    expect(machineLocation('node-mac', machine())).toEqual({
      nodeId: 'node-mac',
      name: 'Mac mini (list)',
      platform: 'macOS arm64',
      state: 'ready',
    });
    expect(machineLocation('node-mac', machine({ state: 'unreachable' }))?.state).toBe(
      'unreachable',
    );
    expect(machineLocation('node-mac', machine({ state: 'revoked' }))?.state).toBe('revoked');
  });
  it('names an unlisted machine generically and is null without a machine', () => {
    expect(machineLocation('node-gone', machine())).toEqual({
      nodeId: 'node-gone',
      name: 'Another machine',
      platform: null,
      state: 'ready',
    });
    expect(machineLocation('', machine())).toBeNull();
  });
});
