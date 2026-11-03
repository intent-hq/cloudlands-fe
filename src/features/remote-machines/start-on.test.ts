import { describe, expect, it } from 'vitest';
import type { RemoteMachine } from '$shared/types/remote-machines';
import {
  initialAgentPlacement,
  resolveStartOn,
  startOnOptions,
  startOnVisible,
  START_ON_BACKEND,
} from './start-on';

const machine = (id: string, extra: Partial<RemoteMachine> = {}): RemoteMachine => ({
  id,
  name: id,
  hosts: [],
  port: 7443,
  fingerprint: `fp-${id}`,
  state: 'connected',
  runningAgents: 0,
  addedAt: '2026-11-01T00:00:00Z',
  ...extra,
});

describe('startOnOptions', () => {
  it('lists the backend first, then each machine, disabling unusable ones with a reason', () => {
    const options = startOnOptions({
      backendLabel: 'intent1',
      machines: [
        machine('mac', { name: 'Mac mini', platform: { os: 'macos', arch: 'aarch64' } }),
        machine('idle', { name: 'Idle box', state: 'disconnected' }),
        machine('gone', { name: 'Gone', state: 'unreachable' }),
        machine('rev', { name: 'Revoked', state: 'revoked' }),
        machine('old', { name: 'Old', state: 'update-required' }),
      ],
    });
    expect(options).toEqual([
      { id: START_ON_BACKEND, label: 'intent1', platform: null, disabled: false },
      { id: 'mac', label: 'Mac mini', platform: 'macOS arm64', disabled: false },
      { id: 'idle', label: 'Idle box', platform: null, disabled: false },
      { id: 'gone', label: 'Gone', platform: null, disabled: true, reason: 'Unreachable' },
      { id: 'rev', label: 'Revoked', platform: null, disabled: true, reason: 'Access revoked' },
      { id: 'old', label: 'Old', platform: null, disabled: true, reason: 'Update required' },
    ]);
  });
});

describe('startOnVisible', () => {
  const usable = [machine('mac')];
  it('shows with the remote surfaces on, support for the placement and a usable machine', () => {
    expect(startOnVisible({ remoteMachinesVisible: true, supported: true, machines: usable })).toBe(
      true,
    );
  });
  it('hides with the Labs flag off or an older backend', () => {
    expect(
      startOnVisible({ remoteMachinesVisible: false, supported: true, machines: usable }),
    ).toBe(false);
    expect(
      startOnVisible({ remoteMachinesVisible: true, supported: false, machines: usable }),
    ).toBe(false);
  });
  it('hides when no other machine is usable', () => {
    expect(startOnVisible({ remoteMachinesVisible: true, supported: true, machines: [] })).toBe(
      false,
    );
    expect(
      startOnVisible({
        remoteMachinesVisible: true,
        supported: true,
        machines: [machine('gone', { state: 'unreachable' }), machine('r', { state: 'revoked' })],
      }),
    ).toBe(false);
  });
});

describe('resolveStartOn', () => {
  const machines = [machine('mac'), machine('gone', { state: 'unreachable' })];
  it('defaults to the backend', () => {
    expect(resolveStartOn(undefined, machines)).toBe(START_ON_BACKEND);
    expect(resolveStartOn('', machines)).toBe(START_ON_BACKEND);
  });
  it('keeps a remembered machine that is still usable', () => {
    expect(resolveStartOn('mac', machines)).toBe('mac');
  });
  it('falls back to the backend for a missing or unusable machine', () => {
    expect(resolveStartOn('removed', machines)).toBe(START_ON_BACKEND);
    expect(resolveStartOn('gone', machines)).toBe(START_ON_BACKEND);
  });
});

describe('initialAgentPlacement', () => {
  it('is the closed remote placement for a machine and absent for the backend', () => {
    expect(initialAgentPlacement('mac')).toEqual({ target: 'remote', nodeId: 'mac' });
    expect(initialAgentPlacement(START_ON_BACKEND)).toBeUndefined();
    expect(initialAgentPlacement(undefined)).toBeUndefined();
  });
});
