import { describe, expect, it } from 'vitest';
import type { ProviderProfileSummary } from '$shared/provider-catalog';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { buildMachineModelGroups } from '$lib/components/chat/input/model-picker-groups';
import {
  isRemoteRefSignedOut,
  machineReportFreshness,
  MACHINE_REPORT_STALE_MS,
  defaultRemoteSends,
  remoteAutoPickProfile,
  remoteIncompatibilityFor,
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

  it('lists installed providers it can run, hiding a profile that cannot be sent', () => {
    expect(groups.map((group) => group.key)).toEqual(['claude-code', 'codex', 'codex@p-key']);
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

  it('offers a signed-out Default only when it brings credentials (unknown counts as yes)', () => {
    expect(byKey.codex.options).toEqual([{ value: 'gpt-6', label: 'gpt-6' }]);
    const build = (
      defaultHasOverrides: Record<string, boolean>,
      defaultRemoteIncompatibility?: Record<string, { reason: string; keys: string[] }>,
    ) =>
      buildMachineModelGroups({
        machine: machine(),
        providerRefs: ['codex'],
        groupLabel: (ref) => ref,
        catalogModels: {},
        catalogProfiles: [],
        defaultHasOverrides,
        defaultRemoteIncompatibility,
      }).map((group) => group.key);
    // No overrides: nothing to send, and the machine isn't signed in.
    expect(build({ codex: false })).toEqual([]);
    // An API key in a marked Default's overrides is sent.
    expect(build({ codex: true })).toEqual(['codex']);
    // An unmarked Default sends nothing.
    expect(build({ codex: true }, { codex: { reason: 'not-marked', keys: [] } })).toEqual([]);
  });

  it("runs an unmarked Default with the machine's own sign-in when it has one", () => {
    const keys = buildMachineModelGroups({
      machine: machine(),
      providerRefs: ['claude-code'],
      groupLabel: (ref) => ref,
      catalogModels: {},
      catalogProfiles: [],
      defaultHasOverrides: { 'claude-code': false },
      defaultRemoteIncompatibility: { 'claude-code': { reason: 'not-marked', keys: [] } },
    }).map((group) => group.key);
    expect(keys).toEqual(['claude-code']);
  });

  it('offers a marked profile on a signed-out machine', () => {
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

    it("never lists the Default's models for a profile whose own list hasn't loaded", () => {
      // A Bedrock or Vertex profile can serve different models than its Default.
      expect(build(['claude-code@p-unloaded'])).toEqual({ 'claude-code@p-unloaded': [] });
    });

    it("lists the backend's models for a Default whose overrides bring credentials", () => {
      expect(build(['claude-code', 'codex'], { 'claude-code': true, codex: true })).toEqual({
        'claude-code': [{ value: 'opus', label: 'Opus 5.5' }],
        codex: [{ value: 'gpt-6', label: 'GPT-6' }],
      });
    });

    it("keeps a Default without overrides on the machine's own (empty) list", () => {
      // Codex is signed out there and its Default has nothing to send: hidden.
      expect(build(['claude-code', 'codex'], { 'claude-code': false, codex: false })).toEqual({
        'claude-code': [],
      });
      // Unknown overrides: no evidence the Default brings credentials.
      expect(build(['claude-code'])).toEqual({ 'claude-code': [] });
    });

    it('hides a configuration that cannot be sent', () => {
      expect(build(['claude-code@p-work'])).toEqual({});
    });

    it('offers only what can be sent on an E2B sandbox, which has no sign-in', () => {
      const e2b = machine({
        cloud: { state: 'running' } as RemoteMachine['cloud'],
        capabilities: { providers: [{ id: 'claude-code', status: 'unknown', models: [] }] },
      });
      // The plain Default auto-picks the marked profile; with none it is hidden.
      expect(
        Object.keys(
          build(['claude-code', 'claude-code@p-personal'], { 'claude-code': false }, e2b),
        ),
      ).toEqual(['claude-code', 'claude-code@p-personal']);
      expect(
        buildMachineModelGroups({
          machine: e2b,
          providerRefs: ['claude-code'],
          groupLabel: (ref) => ref,
          catalogModels,
          catalogProfiles: [work],
          defaultHasOverrides: { 'claude-code': false },
        }),
      ).toEqual([]);
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

describe('remoteAutoPickProfile', () => {
  const second: ProviderProfileSummary = {
    ...apiKey,
    id: 'p-key2',
    providerRef: 'codex@p-key2',
    name: 'Second',
  };
  const unmarked: ProviderProfileSummary = {
    ...apiKey,
    id: 'p-off',
    providerRef: 'codex@p-off',
    name: 'Off',
    remoteCompatible: false,
    remoteIncompatibility: { reason: 'not-marked', keys: [] },
  };
  const pick = (input: Partial<Parameters<typeof remoteAutoPickProfile>[0]>) =>
    remoteAutoPickProfile({
      machine: machine(),
      providerRef: 'codex',
      catalogProfiles: [unmarked, apiKey, second],
      defaultHasOverrides: { codex: false },
      ...input,
    })?.name ?? null;

  it('uses the first Remote Ready profile in saved order when the machine is signed out', () => {
    expect(pick({})).toBe('API key');
  });
  it("tries the machine's own sign-in first when it is signed in or unknown", () => {
    expect(pick({ providerRef: 'claude-code' })).toBeNull();
    const unknown = machine({
      capabilities: { providers: [{ id: 'codex', status: 'unknown', models: [] }] },
    });
    expect(pick({ machine: unknown })).toBeNull();
  });
  it('never replaces an explicitly chosen profile', () => {
    expect(pick({ providerRef: 'codex@p-off' })).toBeNull();
  });
  it('sends a marked Default with credentials itself', () => {
    expect(pick({ defaultHasOverrides: { codex: true } })).toBeNull();
    expect(
      pick({
        defaultHasOverrides: { codex: true },
        defaultRemoteIncompatibility: { codex: { reason: 'not-marked', keys: [] } },
      }),
    ).toBe('API key');
  });
  it('has nothing to pick without a Remote Ready profile', () => {
    expect(pick({ catalogProfiles: [unmarked] })).toBeNull();
  });
  it('applies on an E2B sandbox, which has no sign-in', () => {
    const e2b = machine({
      cloud: { state: 'running' } as RemoteMachine['cloud'],
      capabilities: { providers: [{ id: 'codex', status: 'unknown', models: [] }] },
    });
    expect(pick({ machine: e2b })).toBe('API key');
  });
  it('offers the plain Default when it auto-picks, with that profile’s models', () => {
    const groups = buildMachineModelGroups({
      machine: machine({
        capabilities: { providers: [{ id: 'codex', status: 'signed-out', models: [] }] },
      }),
      providerRefs: ['codex'],
      groupLabel: (ref) => ref,
      catalogModels: { 'codex@p-key': [{ value: 'gpt-6', label: 'GPT-6' }] },
      catalogProfiles: [apiKey],
      defaultHasOverrides: { codex: false },
    });
    expect(groups).toEqual([
      { key: 'codex', label: 'codex', options: [{ value: 'gpt-6', label: 'GPT-6' }] },
    ]);
  });
});

describe('the Default on a remote machine (catalog defaultRemoteLaunch)', () => {
  it('sends only when marked ("send") and not known to have nothing to send', () => {
    const launch = { codex: 'send', 'claude-code': 'machine-sign-in' };
    expect(defaultRemoteSends('codex', { defaultRemoteLaunch: launch })).toBe(true);
    expect(
      defaultRemoteSends('codex', {
        defaultRemoteLaunch: launch,
        defaultHasOverrides: { codex: false },
      }),
    ).toBe(false);
    // Absent from the old incompatibility map no longer means marked.
    expect(defaultRemoteSends('claude-code', { defaultRemoteLaunch: launch })).toBe(false);
  });

  it('falls back to the incompatibility map on a daemon without defaultRemoteLaunch', () => {
    expect(defaultRemoteSends('codex', {})).toBe(true);
    expect(
      defaultRemoteSends('codex', {
        defaultRemoteIncompatibility: { codex: { reason: 'account-folder', keys: [] } },
      }),
    ).toBe(false);
  });

  const keys = (
    defaultRemoteLaunch: Record<string, string>,
    catalogProfiles = [] as ProviderProfileSummary[],
  ) =>
    buildMachineModelGroups({
      machine: machine(),
      providerRefs: ['claude-code', 'codex'],
      groupLabel: (ref) => ref,
      catalogModels: {},
      catalogProfiles,
      defaultRemoteLaunch,
    }).map((group) => group.key);

  it("runs an unmarked Default with the machine's sign-in, and hides it when signed out", () => {
    // claude-code is ready on the machine, codex is signed out.
    expect(keys({ 'claude-code': 'machine-sign-in', codex: 'machine-sign-in' })).toEqual([
      'claude-code',
    ]);
  });

  it('offers a marked Default on a signed-out machine', () => {
    expect(keys({ 'claude-code': 'machine-sign-in', codex: 'send' })).toEqual([
      'claude-code',
      'codex',
    ]);
  });

  it('hides a refused Default even where the machine is signed in', () => {
    expect(keys({ 'claude-code': 'refused', codex: 'machine-sign-in' })).toEqual([]);
  });

  it('auto-picks a Remote Ready profile for an unmarked Default on a signed-out machine', () => {
    expect(keys({ 'claude-code': 'machine-sign-in', codex: 'machine-sign-in' }, [apiKey])).toEqual([
      'claude-code',
      'codex',
    ]);
  });
});
