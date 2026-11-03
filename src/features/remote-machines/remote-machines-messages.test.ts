import { describe, expect, it } from 'vitest';
import type { RemoteMachineFailure } from '$shared/types/remote-machines';
import { remoteMachineFailureMessage, remoteMachineFailureRetry } from './remote-machines-messages';

const labels = { machine: 'Studio Mac', backend: 'Build box' };
const failure = (extra: Partial<RemoteMachineFailure>): RemoteMachineFailure => ({
  success: false,
  code: 'failed',
  ...extra,
});

describe('remote machine failure messages', () => {
  it('says unconfirmed stops removed nothing, with the agent count', () => {
    const many = remoteMachineFailureMessage(
      failure({ code: 'machine-unreachable', attempts: [], unconfirmedStops: ['a-1', 'a-2'] }),
      labels,
    );
    expect(many).toContain('Studio Mac');
    expect(many).toContain('2');
    expect(many).toContain('still available to Build box');
    const one = remoteMachineFailureMessage(
      failure({ code: 'machine-unreachable', unconfirmedStops: ['a-1'] }),
      labels,
    );
    expect(one).toContain('1 agent ');
    expect(one).not.toEqual(many);
  });

  it('keeps the expose wording for a plain unreachable failure', () => {
    expect(remoteMachineFailureMessage(failure({ code: 'machine-unreachable' }), labels)).toBe(
      "Build box couldn't reach Studio Mac, so nothing was saved.",
    );
  });

  it('names the version gap for machine-update-required', () => {
    expect(
      remoteMachineFailureMessage(
        failure({
          code: 'machine-update-required',
          update: 'machine',
          machineVersion: '0.9.0',
          backendVersion: '0.10.0',
        }),
        labels,
      ),
    ).toContain('it runs 0.9.0; this backend needs 0.10.0 or newer');
  });
});

describe('remote machine failure retry', () => {
  it('retries removal with stopAgents for unconfirmed stops and machine-in-use', () => {
    expect(
      remoteMachineFailureRetry(failure({ code: 'machine-unreachable', unconfirmedStops: ['a'] })),
    ).toBe('retry-stop-agents');
    expect(remoteMachineFailureRetry(failure({ code: 'machine-in-use', runningAgents: 1 }))).toBe(
      'stop-agents',
    );
  });

  it('offers no removal retry for an expose-time unreachable failure', () => {
    expect(remoteMachineFailureRetry(failure({ code: 'machine-unreachable' }))).toBeNull();
    expect(
      remoteMachineFailureRetry(failure({ code: 'machine-unreachable', unconfirmedStops: [] })),
    ).toBeNull();
  });
});
