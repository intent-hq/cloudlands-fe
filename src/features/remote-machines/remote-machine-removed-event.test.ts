/**
 * `remoteMachine:changed { machineId, removed: true, reason: "orchestrator" }`
 * (PROTOCOL `methods/nodes.md` → "An orchestrator leaves its backends"): the
 * bridge removes the runner and names it, read before the row goes, so the
 * notice can say which runner left.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import { remoteMachineRemoved, remoteMachinesLoaded } from './remote-machines-slice';

const MACHINE = {
  id: 'd-cache',
  name: 'Intent cache',
  hosts: ['192.0.2.50'],
  port: 5179,
  fingerprint: 'AA:50',
  state: 'connected' as const,
  runningAgents: 0,
  addedAt: '2026-11-20T00:00:00Z',
};

beforeEach(() => {
  store.init();
  store.dispatch(backendReconnected());
  store.dispatch(
    remoteMachinesLoaded({
      supported: true,
      machines: [MACHINE],
      localFingerprint: null,
      executorBackends: [],
    }),
  );
  vi.spyOn(store, 'dispatch');
});

afterEach(() => vi.restoreAllMocks());

const event = (data: Record<string, unknown>) =>
  routeDaemonEventsNotification('events.event', {
    event: { type: 'remoteMachine:changed', data },
  });

describe('remoteMachine:changed removals', () => {
  it('names a runner removed because it is now an orchestrator', () => {
    event({ machineId: 'd-cache', removed: true, reason: 'orchestrator' });
    expect(store.dispatch).toHaveBeenCalledWith(
      remoteMachineRemoved('d-cache', { reason: 'orchestrator', name: 'Intent cache' }),
    );
    expect(store.state.remoteMachines.machines['d-cache']).toBeUndefined();
  });

  it('keeps an ordinary removal without a reason', () => {
    event({ machineId: 'd-cache', removed: true });
    expect(store.dispatch).toHaveBeenCalledWith(remoteMachineRemoved('d-cache'));
  });

  it('ignores an unknown reason', () => {
    event({ machineId: 'd-cache', removed: true, reason: 'something-new' });
    expect(store.dispatch).toHaveBeenCalledWith(remoteMachineRemoved('d-cache'));
  });

  it('removes an unloaded runner without a notice, since it has no name to show', () => {
    event({ machineId: 'd-unknown', removed: true, reason: 'orchestrator' });
    expect(store.dispatch).toHaveBeenCalledWith(remoteMachineRemoved('d-unknown'));
    expect(store.state.remoteMachines.machines['d-cache']).toBeDefined();
  });
});
