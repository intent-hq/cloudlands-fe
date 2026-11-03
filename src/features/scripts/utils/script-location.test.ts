import { describe, expect, it } from 'vitest';
import type { AgentSession } from '$shared/types';
import type { RemoteMachine } from '$shared/types/remote-machines';
import {
  isLostRun,
  machineRunStatus,
  machineRunLocation,
  scriptLostReason,
  scriptMachineRuns,
} from './script-location';

const machine = (extra: Partial<RemoteMachine> = {}): RemoteMachine => ({
  id: 'node-mac',
  name: 'Mac Studio',
  platform: { os: 'macos', arch: 'aarch64' },
  hosts: [],
  port: 7443,
  fingerprint: 'fp',
  state: 'connected',
  runningAgents: 1,
  addedAt: '2026-11-01T00:00:00Z',
  ...extra,
});

const agent = (extra: Partial<AgentSession> = {}): AgentSession =>
  ({
    id: 'agent-1',
    nodeId: 'node-mac',
    nodeName: 'Mac Studio (agent)',
    placement: { target: 'remote', checkout: 'isolated', os: 'macos', arch: 'aarch64' },
    ...extra,
  }) as unknown as AgentSession;

const run = {
  remoteAgentId: 'agent-1',
  nodeId: 'node-mac',
  runtime: { status: 'running' as const, restartCount: 0 },
};

describe('scriptMachineRuns', () => {
  it('reads well-formed machineRuns entries in order', () => {
    const other = { ...run, remoteAgentId: 'agent-2' };
    expect(scriptMachineRuns({ machineRuns: [run, other] })).toEqual([run, other]);
  });

  it('is empty for backend-only scripts and drops malformed entries', () => {
    expect(scriptMachineRuns({})).toEqual([]);
    expect(scriptMachineRuns({ machineRuns: null })).toEqual([]);
    expect(scriptMachineRuns({ machineRuns: 'x' })).toEqual([]);
    expect(
      scriptMachineRuns({
        machineRuns: [
          null,
          { ...run, remoteAgentId: '' },
          { ...run, nodeId: undefined },
          { ...run, runtime: null },
          { ...run, runtime: { restartCount: 0 } },
          run,
        ],
      }),
    ).toEqual([run]);
  });
});

describe('machineRunLocation', () => {
  it('prefers the listed machine name and platform', () => {
    expect(machineRunLocation(run, agent(), machine())).toEqual({
      nodeId: 'node-mac',
      name: 'Mac Studio',
      platform: 'macOS arm64',
      state: 'ready',
    });
  });

  it("falls back to the agent's machine name and platform without a listed row", () => {
    expect(machineRunLocation(run, agent(), null)).toMatchObject({
      name: 'Mac Studio (agent)',
      platform: 'macOS arm64',
      state: 'ready',
    });
  });

  it('ignores an agent placed on a different machine', () => {
    expect(
      machineRunLocation(run, agent({ nodeId: 'node-other', nodeName: 'Other' }), null),
    ).toMatchObject({ name: 'Another machine', platform: null });
  });

  it('names the machine state', () => {
    expect(machineRunLocation(run, null, machine({ state: 'unreachable' })).state).toBe(
      'unreachable',
    );
    expect(machineRunLocation(run, null, machine({ state: 'revoked' })).state).toBe('revoked');
  });
});

describe('isLostRun', () => {
  it('is lost when the run exited with -1', () => {
    expect(isLostRun({ status: 'exited', exitCode: -1 })).toBe(true);
  });

  it('is not lost for other exits or live states', () => {
    expect(isLostRun({ status: 'exited', exitCode: 1 })).toBe(false);
    expect(isLostRun({ status: 'exited' })).toBe(false);
    expect(isLostRun({ status: 'running' })).toBe(false);
  });
});

describe('scriptLostReason', () => {
  it('returns the runtime error, trimmed', () => {
    expect(scriptLostReason({ error: ' gone ' })).toBe('gone');
  });

  it('names the two documented lost reasons in the app language', () => {
    expect(scriptLostReason({ error: 'remote-script-lost: the machine disconnected' })).toBe(
      'The machine disconnected',
    );
    expect(scriptLostReason({ error: 'remote-script-lost: the machine was removed' })).toBe(
      'The machine was removed',
    );
  });

  it('shows any other reported reason without the code prefix', () => {
    expect(scriptLostReason({ error: 'remote-script-lost: link reset by peer' })).toBe(
      'link reset by peer',
    );
    expect(scriptLostReason({ error: 'remote-script-lost:' })).toBe(
      'Lost contact with the machine',
    );
  });

  it('falls back to a generic reason', () => {
    expect(scriptLostReason({})).toBe('Lost contact with the machine');
  });
});

describe('machineRunStatus', () => {
  it('names a lost run with its reason', () => {
    expect(
      machineRunStatus({
        status: 'exited',
        exitCode: -1,
        restartCount: 0,
        error: 'remote-script-lost: the machine was removed',
      }),
    ).toEqual({ kind: 'lost', label: 'Lost: The machine was removed' });
  });

  it('uses the regular script statuses otherwise', () => {
    expect(machineRunStatus({ status: 'running', restartCount: 0 }).kind).toBe('running');
    expect(machineRunStatus({ status: 'exited', exitCode: 0, restartCount: 0 }).kind).toBe(
      'succeeded',
    );
    expect(machineRunStatus({ status: 'exited', exitCode: 2, restartCount: 0 })).toEqual({
      kind: 'failed',
      label: 'Error (2)',
    });
  });
});
