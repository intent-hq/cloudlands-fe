import { describe, expect, it, vi } from 'vitest';
import type { HardwareConsoleManager, HardwareConsoleStatus } from '../../device/device-manager';
import { HardwareLedEngine } from '../engine';
import type { LedSnapshotState } from '../snapshot';
import { installHardwareConsoleLedStatus } from '../led-status-service';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';

function makeFakeManager(initialStatus: HardwareConsoleStatus = 'disconnected') {
  const statusListeners = new Set<(status: HardwareConsoleStatus) => void>();
  const calls: { method: string; params: unknown }[] = [];
  const client = {
    call: vi.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      return Promise.resolve({ ok: 1 });
    }),
  };
  const fake = {
    status: initialStatus,
    client: initialStatus === 'connected' ? client : null,
    calls,
    onStatusChange(listener: (status: HardwareConsoleStatus) => void) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    setStatus(status: HardwareConsoleStatus) {
      fake.status = status;
      fake.client = status === 'connected' ? client : null;
      for (const listener of statusListeners) listener(status);
    },
  };
  return fake;
}

function makeStateSource() {
  const state: LedSnapshotState = {
    workspace: { workspaces: createCollection('id', []) },
    hardwareConsole: { keyPins: [null, null, null, null, null, null] },
  };
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify: () => {
      for (const listener of listeners) listener();
    },
  };
}

describe('installHardwareConsoleLedStatus', () => {
  it('paints on connect and replays after reconnect', () => {
    const manager = makeFakeManager('disconnected');
    const source = makeStateSource();
    const engine = new HardwareLedEngine({ minSendIntervalMs: 0 });
    const teardown = installHardwareConsoleLedStatus(manager as unknown as HardwareConsoleManager, {
      engine,
      getState: source.getState,
      subscribe: source.subscribe,
    });
    expect(manager.calls).toHaveLength(0);

    manager.setStatus('connected');
    expect(manager.calls.map((entry) => entry.method)).toEqual(['v.oai.thstatus', 'v.oai.rgbcfg']);

    manager.setStatus('disconnected');
    manager.calls.length = 0;
    manager.setStatus('connected');
    expect(manager.calls.map((entry) => entry.method)).toEqual(['v.oai.thstatus', 'v.oai.rgbcfg']);

    teardown();
  });

  it('store changes refresh the engine while connected', () => {
    const manager = makeFakeManager('connected');
    const source = makeStateSource();
    const engine = new HardwareLedEngine({ minSendIntervalMs: 0 });
    const updateSpy = vi.spyOn(engine, 'update');
    const teardown = installHardwareConsoleLedStatus(manager as unknown as HardwareConsoleManager, {
      engine,
      getState: source.getState,
      subscribe: source.subscribe,
    });
    const before = updateSpy.mock.calls.length;
    source.notify();
    expect(updateSpy.mock.calls.length).toBe(before + 1);
    // Identical snapshot content — engine dedupes, no extra device calls.
    expect(manager.calls.map((entry) => entry.method)).toEqual(['v.oai.thstatus', 'v.oai.rgbcfg']);
    teardown();
  });

  it('teardown detaches and unsubscribes', () => {
    const manager = makeFakeManager('connected');
    const source = makeStateSource();
    const engine = new HardwareLedEngine({ minSendIntervalMs: 0 });
    const teardown = installHardwareConsoleLedStatus(manager as unknown as HardwareConsoleManager, {
      engine,
      getState: source.getState,
      subscribe: source.subscribe,
    });
    teardown();
    const updateSpy = vi.spyOn(engine, 'update');
    source.notify();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
