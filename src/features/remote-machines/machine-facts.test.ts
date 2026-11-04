import { describe, expect, it } from 'vitest';
import type { ConnectionRecord } from '$shared/types/connections';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { machinePlatform, machineRowPlatform, machineRowProviders } from './machine-facts';

const device: ConnectionRecord = {
  id: 'mini',
  label: 'Mac mini',
  host: '192.0.2.2',
  port: 5181,
  fingerprint: 'AA',
  isLocal: false,
  status: 'connected',
};

function machine(overrides: Partial<RemoteMachine> = {}): RemoteMachine {
  return {
    id: 'm-studio',
    name: 'Mac Studio',
    platform: { os: 'macos', arch: 'aarch64' },
    hosts: ['192.0.2.4'],
    port: 5181,
    fingerprint: 'BB',
    state: 'connected',
    runningAgents: 0,
    capabilities: {
      providers: [
        { id: 'claude-code', status: 'signed-in', models: [] },
        { id: 'codex', status: 'signed-out', models: [] },
        { id: 'grok', status: 'cli-missing', models: [] },
        { id: 'pi', status: 'prerequisite-missing', models: [] },
        { id: 'unsloth', status: 'unknown', models: [] },
      ],
    },
    addedAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

const noNames = () => undefined;

describe('machinePlatform', () => {
  it.each([
    ['macos', 'macos'],
    ['darwin', 'macos'],
    ['MacOS', 'macos'],
    ['windows', 'windows'],
    ['win32', 'windows'],
    ['linux', 'linux'],
  ] as const)('maps %s to %s', (os, platform) => {
    expect(machinePlatform(os)).toBe(platform);
  });

  it.each([undefined, null, '', 'freebsd', 'ios'])('is unknown for %s', (os) => {
    expect(machinePlatform(os)).toBeNull();
  });
});

describe('machineRowPlatform', () => {
  it("uses the connected daemon's host OS", () => {
    expect(machineRowPlatform({ ...device, hostOs: 'linux' }, null)).toBe('linux');
  });

  it('falls back to the machine report for a row made available to the backend', () => {
    expect(machineRowPlatform(device, machine({ platform: { os: 'windows', arch: 'x86_64' } }))).toBe(
      'windows',
    );
  });

  it('is unknown with neither source (offline, older daemon)', () => {
    expect(machineRowPlatform({ ...device, status: 'disconnected' }, null)).toBeNull();
    expect(machineRowPlatform(device, machine({ platform: undefined }))).toBeNull();
  });
});

describe('machineRowProviders', () => {
  it("lists the connected daemon's installed providers with their catalog names", () => {
    const names: Record<string, string> = { 'claude-code': 'Claude' };
    expect(
      machineRowProviders(
        {
          ...device,
          providers: [
            { id: 'claude-code', displayName: 'Claude Code' },
            { id: 'codex', displayName: 'Codex' },
          ],
        },
        null,
        (id) => names[id],
      ),
    ).toEqual([
      { id: 'claude-code', name: 'Claude' },
      { id: 'codex', name: 'Codex' },
    ]);
  });

  it('prefers the live capture over the machine report', () => {
    expect(
      machineRowProviders(
        { ...device, providers: [{ id: 'codex', displayName: 'Codex' }] },
        machine(),
        noNames,
      ).map((provider) => provider.id),
    ).toEqual(['codex']);
  });

  it('uses the machine report of a connected machine, dropping providers that are not installed', () => {
    expect(machineRowProviders(device, machine(), noNames)).toEqual([
      { id: 'claude-code', name: 'claude-code' },
      { id: 'codex', name: 'codex' },
      { id: 'unsloth', name: 'unsloth' },
    ]);
  });

  it('shows nothing for an unreachable machine or one without a report', () => {
    expect(machineRowProviders(device, machine({ state: 'unreachable' }), noNames)).toEqual([]);
    expect(machineRowProviders(device, machine({ capabilities: undefined }), noNames)).toEqual([]);
    expect(machineRowProviders({ ...device, status: 'disconnected' }, null, noNames)).toEqual([]);
  });
});
