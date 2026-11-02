import { describe, expect, it } from 'vitest';
import type { ProviderProfileSummary } from '$shared/provider-catalog';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { buildMachineModelGroups } from '$lib/components/chat/input/model-picker-groups';
import {
  isRemoteRefSignedOut,
  machineReportFreshness,
  MACHINE_REPORT_STALE_MS,
  remoteIncompatibilityFor,
  remoteIncompatibilityMessage,
  remoteModelSwitchSupport,
} from './remote-model-picker';

const machine = (extra: Partial<RemoteMachine> = {}): RemoteMachine => ({
  id: 'node-mac',
  name: 'Mac mini',
  platform: { os: 'macos', arch: 'aarch64' },
  hosts: [],
  port: 7443,
  fingerprint: 'fp',
  state: 'connected',
  runningAgents: 1,
  addedAt: '2026-11-01T00:00:00Z',
  observedAt: '2026-11-02T12:00:00Z',
  capabilities: {
    providers: [
      { id: 'claude-code', status: 'ready', models: ['opus', 'sonnet', 'only-on-machine'] },
      { id: 'codex', status: 'signed-out', models: ['gpt-6'] },
      { id: 'opencode', status: 'cli-missing', models: [] },
    ],
  },
  ...extra,
});

const work: ProviderProfileSummary = {
  id: 'p-work',
  providerRef: 'claude-code@p-work',
  baseProviderId: 'claude-code',
  name: 'Work',
  remoteCompatible: false,
  remoteIncompatibility: { reason: 'account-folder', keys: ['CLAUDE_CONFIG_DIR'] },
};
const apiKey: ProviderProfileSummary = {
  id: 'p-key',
  providerRef: 'codex@p-key',
  baseProviderId: 'codex',
  name: 'API key',
  remoteCompatible: true,
};
const legacy: ProviderProfileSummary = {
  id: 'p-old',
  providerRef: 'claude-code@p-old',
  baseProviderId: 'claude-code',
  name: 'Old',
};

describe('remoteModelSwitchSupport', () => {
  const base = { catalogProfiles: [], profileDefaults: [], profilesLoadStatus: 'idle' as const };

  it('is supported when a catalog profile row carries remoteCompatible', () => {
    expect(remoteModelSwitchSupport({ ...base, catalogProfiles: [apiKey] })).toBe('supported');
  });

  it('is supported when the catalog names an incompatible Default', () => {
    expect(
      remoteModelSwitchSupport({
        ...base,
        defaultRemoteIncompatibility: {
          codex: { reason: 'account-folder', keys: ['CODEX_HOME'] },
        },
      }),
    ).toBe('supported');
  });

  it('is supported when the profile list Default rows carry remoteCompatible', () => {
    expect(
      remoteModelSwitchSupport({
        ...base,
        profileDefaults: [
          { baseProviderId: 'codex', name: 'Default', env: [], remoteCompatible: true },
        ],
        profilesLoadStatus: 'success',
      }),
    ).toBe('supported');
  });

  it('is unsupported when profile rows lack the field (older daemon)', () => {
    expect(remoteModelSwitchSupport({ ...base, catalogProfiles: [legacy] })).toBe('unsupported');
    expect(
      remoteModelSwitchSupport({
        ...base,
        profileDefaults: [{ baseProviderId: 'codex', name: 'Default', env: [] }],
        profilesLoadStatus: 'success',
      }),
    ).toBe('unsupported');
    expect(remoteModelSwitchSupport({ ...base, profilesLoadStatus: 'failure' })).toBe(
      'unsupported',
    );
  });

  it('is unknown until the profile list is read when the catalog cannot tell', () => {
    expect(remoteModelSwitchSupport(base)).toBe('unknown');
  });
});

describe('remoteIncompatibilityFor', () => {
  it('reads profile rows and the Default map; absence is compatible', () => {
    expect(remoteIncompatibilityFor('claude-code@p-work', [work])).toEqual({
      reason: 'account-folder',
      keys: ['CLAUDE_CONFIG_DIR'],
    });
    expect(remoteIncompatibilityFor('codex@p-key', [apiKey])).toBeNull();
    expect(remoteIncompatibilityFor('claude-code@p-old', [legacy])).toBeNull();
    expect(
      remoteIncompatibilityFor('codex', [], {
        codex: { reason: 'account-folder', keys: ['CODEX_HOME'] },
      }),
    ).toEqual({ reason: 'account-folder', keys: ['CODEX_HOME'] });
    expect(remoteIncompatibilityFor('claude-code', [])).toBeNull();
  });

  it('treats remoteCompatible false without details as incompatible', () => {
    const bare = { ...work, remoteIncompatibility: undefined };
    expect(remoteIncompatibilityFor('claude-code@p-work', [bare])?.reason).toBe('unknown');
  });

  it('names the backend for an account folder and stays generic for unknown reasons', () => {
    expect(remoteIncompatibilityMessage({ reason: 'account-folder', keys: [] }, 'Studio')).toBe(
      "Uses an account folder on Studio, so it can't run on other machines",
    );
    expect(remoteIncompatibilityMessage({ reason: 'future', keys: [] }, 'Studio')).toBe(
      "This configuration can't run on other machines",
    );
  });
});

describe('machineReportFreshness', () => {
  const now = Date.parse('2026-11-02T12:30:00Z');
  it('is missing without capabilities, stale after a day, fresh otherwise', () => {
    expect(machineReportFreshness(null, now)).toBe('missing');
    expect(machineReportFreshness(machine({ capabilities: undefined }), now)).toBe('missing');
    expect(machineReportFreshness(machine(), now)).toBe('fresh');
    expect(
      machineReportFreshness(
        machine({ observedAt: new Date(now - MACHINE_REPORT_STALE_MS - 1).toISOString() }),
        now,
      ),
    ).toBe('stale');
  });
});

describe('isRemoteRefSignedOut', () => {
  it('flags only a Default whose provider is signed out on the machine', () => {
    expect(isRemoteRefSignedOut(machine(), 'codex')).toBe(true);
    expect(isRemoteRefSignedOut(machine(), 'codex@p-key')).toBe(false);
    expect(isRemoteRefSignedOut(machine(), 'claude-code')).toBe(false);
    expect(isRemoteRefSignedOut(null, 'codex')).toBe(false);
  });
});

describe('buildMachineModelGroups', () => {
  const groups = buildMachineModelGroups({
    machine: machine(),
    providerRefs: [
      'claude-code',
      'claude-code@p-work',
      'codex',
      'codex@p-key',
      'opencode',
      'auggie',
    ],
    groupLabel: (ref) => `label:${ref}`,
    catalogModels: {
      'claude-code': [
        { value: 'opus', label: 'Opus 5.5', description: 'Most capable' },
        { value: 'sonnet', label: 'Sonnet 5' },
        { value: 'backend-only', label: 'Backend only' },
      ],
    },
    catalogProfiles: [work, apiKey],
  });
  const byKey = Object.fromEntries(groups.map((group) => [group.key, group]));

  it('lists only providers the machine reports as installed', () => {
    expect(groups.map((group) => group.key)).toEqual([
      'claude-code',
      'claude-code@p-work',
      'codex',
      'codex@p-key',
    ]);
  });

  it("lists the machine's models with backend labels, falling back to the raw id", () => {
    expect(byKey['claude-code'].options.map((option) => [option.value, option.label])).toEqual([
      ['opus', 'Opus 5.5'],
      ['sonnet', 'Sonnet 5'],
      ['only-on-machine', 'only-on-machine'],
    ]);
    expect(byKey['claude-code'].options[0].description).toBe('Most capable');
    expect(byKey['claude-code'].options.every((option) => !option.disabled)).toBe(true);
    expect(byKey['claude-code'].label).toBe('label:claude-code');
  });

  it('greys out a configuration that cannot run on another machine', () => {
    const options = byKey['claude-code@p-work'].options;
    expect(options.map((option) => option.label)).toEqual([
      'Opus 5.5',
      'Sonnet 5',
      'only-on-machine',
    ]);
    expect(options.every((option) => option.disabled)).toBe(true);
    expect(options[0].data?.remoteUnavailable).toBe('incompatible');
  });

  it('greys out a signed-out Default but not a profile with its own credentials', () => {
    expect(byKey.codex.options).toMatchObject([
      { value: 'gpt-6', disabled: true, data: { remoteUnavailable: 'signed-out' } },
    ]);
    expect(byKey['codex@p-key'].options).toEqual([{ value: 'gpt-6', label: 'gpt-6' }]);
  });

  it('keeps the provider-default row first when asked', () => {
    const withDefault = buildMachineModelGroups({
      machine: machine(),
      providerRefs: ['claude-code'],
      groupLabel: (ref) => ref,
      catalogModels: {},
      catalogProfiles: [],
      useDefaultOption: { value: '__default__', label: 'Provider default' },
    });
    expect(withDefault[0]).toEqual({
      key: 'default',
      label: '',
      options: [{ value: '__default__', label: 'Provider default' }],
    });
  });
});
