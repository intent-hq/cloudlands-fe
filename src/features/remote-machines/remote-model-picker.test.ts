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

  it('keeps a signed-out Default selectable unless it is known to have no overrides', () => {
    // Unknown (the profile list is admin-only): the daemon decides.
    expect(byKey.codex.options).toEqual([{ value: 'gpt-6', label: 'gpt-6' }]);
    const build = (defaultHasOverrides: Record<string, boolean>) =>
      buildMachineModelGroups({
        machine: machine(),
        providerRefs: ['codex'],
        groupLabel: (ref) => ref,
        catalogModels: {},
        catalogProfiles: [],
        defaultHasOverrides,
      })[0].options;
    // No overrides: only the machine's sign-in can run it.
    expect(build({ codex: false })).toMatchObject([
      { value: 'gpt-6', disabled: true, data: { remoteUnavailable: 'signed-out' } },
    ]);
    // An API key in the Default's overrides runs without the machine's sign-in.
    expect(build({ codex: true })).toEqual([{ value: 'gpt-6', label: 'gpt-6' }]);
  });

  it('never greys a profile with its own credentials for a signed-out machine', () => {
    expect(byKey['codex@p-key'].options).toEqual([{ value: 'gpt-6', label: 'gpt-6' }]);
  });

  describe('a machine that lists no models for an installed provider', () => {
    // An E2B sandbox has no Claude Code sign-in of its own: it reports the
    // provider with status unknown and an empty model list.
    const sandbox = machine({
      capabilities: {
        providers: [
          { id: 'claude-code', status: 'unknown', models: [] },
          { id: 'codex', status: 'signed-out', models: [] },
          { id: 'opencode', status: 'cli-missing', models: [] },
        ],
      },
    });
    const personal: ProviderProfileSummary = {
      id: 'p-personal',
      providerRef: 'claude-code@p-personal',
      baseProviderId: 'claude-code',
      name: 'clement@frkz.app',
      remoteCompatible: true,
    };
    const catalogModels = {
      'claude-code': [{ value: 'opus', label: 'Opus 5.5' }],
      'claude-code@p-personal': [
        { value: 'default', label: 'Default' },
        { value: 'claude-code@p-personal:opus', label: 'Opus 5.5', description: 'Most capable' },
        { value: 'sonnet', label: 'Sonnet 5' },
      ],
      'claude-code@p-work': [{ value: 'haiku', label: 'Haiku 5' }],
      codex: [{ value: 'gpt-6', label: 'GPT-6' }],
      opencode: [{ value: 'big-pickle', label: 'Big Pickle' }],
    };
    const build = (
      providerRefs: string[],
      defaultHasOverrides?: Record<string, boolean>,
      target = sandbox,
    ) =>
      Object.fromEntries(
        buildMachineModelGroups({
          machine: target,
          providerRefs,
          groupLabel: (ref) => ref,
          catalogModels,
          catalogProfiles: [personal, work],
          defaultHasOverrides,
        }).map((group) => [group.key, group.options]),
      );

    it("lists the backend's models for a profile, which brings its own credentials", () => {
      expect(build(['claude-code@p-personal'])['claude-code@p-personal']).toEqual([
        { value: 'opus', label: 'Opus 5.5', description: 'Most capable' },
        { value: 'sonnet', label: 'Sonnet 5' },
      ]);
    });

    it("lists the backend's models for a Default whose overrides bring credentials", () => {
      expect(build(['claude-code', 'codex'], { 'claude-code': true, codex: true })).toEqual({
        'claude-code': [{ value: 'opus', label: 'Opus 5.5' }],
        codex: [{ value: 'gpt-6', label: 'GPT-6' }],
      });
    });

    it("keeps a Default without overrides on the machine's own (empty) list", () => {
      expect(build(['claude-code', 'codex'], { 'claude-code': false, codex: false })).toEqual({
        'claude-code': [],
        codex: [],
      });
      // Unknown overrides: no evidence the Default brings credentials.
      expect(build(['claude-code'])).toEqual({ 'claude-code': [] });
    });

    it('keeps a configuration that cannot run on another machine greyed out', () => {
      expect(build(['claude-code@p-work'])['claude-code@p-work']).toEqual([
        {
          value: 'haiku',
          label: 'Haiku 5',
          disabled: true,
          data: { remoteUnavailable: 'incompatible' },
        },
      ]);
    });

    it('still skips a provider the machine reports as not installed', () => {
      expect(build(['opencode@p-x', 'opencode'], { opencode: true })).toEqual({});
    });

    it("prefers the machine's own models when it reports some", () => {
      const reporting = machine({
        capabilities: {
          providers: [{ id: 'claude-code', status: 'signed-out', models: ['haiku'] }],
        },
      });
      expect(build(['claude-code@p-personal'], undefined, reporting)).toEqual({
        'claude-code@p-personal': [{ value: 'haiku', label: 'haiku' }],
      });
    });
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
