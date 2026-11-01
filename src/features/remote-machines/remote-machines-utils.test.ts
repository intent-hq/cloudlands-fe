import { describe, expect, it } from 'vitest';
import {
  fingerprintKey,
  parseRemoteMachine,
  type RemoteMachine,
} from '$shared/types/remote-machines';
import {
  canOfferExpose,
  connectionForMachine,
  machineForConnection,
} from './remote-machines-utils';

const machine = (id: string, fingerprint: string, state: RemoteMachine['state'] = 'connected') =>
  ({
    id,
    name: id,
    hosts: [],
    port: 1,
    fingerprint,
    state,
    runningAgents: 0,
    addedAt: 't',
  }) as RemoteMachine;

describe('remote machine matching', () => {
  const machines = [machine('mac', 'aa:bb'), machine('box', 'CC:DD')];
  const connections = [
    { id: 'local', isLocal: true, fingerprint: null },
    { id: 'box-conn', isLocal: false, fingerprint: ' cc:dd ' },
  ];

  it('matches a saved remote by its pinned fingerprint, case-insensitively', () => {
    expect(machineForConnection(machines, connections[1], null)?.id).toBe('box');
    expect(connectionForMachine(machines[1], connections, null)).toBe('box-conn');
  });

  it('matches this computer by its own daemon fingerprint only', () => {
    expect(machineForConnection(machines, connections[0], null)).toBeNull();
    expect(machineForConnection(machines, connections[0], 'AA:BB')?.id).toBe('mac');
    expect(connectionForMachine(machines[0], connections, 'AA:BB')).toBe('local');
    expect(connectionForMachine(machines[0], connections, null)).toBeNull();
  });

  it('offers expose for unexposed or revoked machines only', () => {
    expect(canOfferExpose(null)).toBe(true);
    expect(canOfferExpose(machine('m', 'x', 'revoked'))).toBe(true);
    for (const state of ['connected', 'disconnected', 'unreachable', 'update-required'] as const)
      expect(canOfferExpose(machine('m', 'x', state))).toBe(false);
  });
});

describe('fingerprintKey', () => {
  it('treats a non-string value as no fingerprint', () => {
    expect(fingerprintKey({ success: false } as unknown as string)).toBeNull();
    expect(fingerprintKey(' aa:bb ')).toBe('AA:BB');
  });
});

describe('parseRemoteMachine', () => {
  it('keeps a tailcat-only machine (no LAN hosts)', () => {
    expect(
      parseRemoteMachine({
        id: 'd-mac',
        name: 'Mac',
        hosts: [],
        tcAddress: 'tc-mac',
        port: 5179,
        fingerprint: 'AA:BB',
        state: 'connected',
        runningAgents: 0,
        addedAt: '2026-11-01T00:00:00Z',
      }),
    ).toMatchObject({ hosts: [], tcAddress: 'tc-mac', state: 'connected' });
  });
});
