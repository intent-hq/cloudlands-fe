/**
 * E2B contracts the app relies on: wire parsing (no key, ever), the Start On
 * row and its placement, which configurations can run on E2B, and how an
 * agent on E2B and its errors read.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import {
  estimateCloudCost,
  parseCloudMachineError,
  parseCloudMachineProvider,
} from '$shared/types/cloud-machines';
import { parseRemoteMachine } from '$shared/types/remote-machines';
import { AgentPlacementRequestSchema, AgentNodeFieldsSchema } from '$shared/types/agent-node';
import { store } from '$store/renderer/store';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import type { AgentSession } from '$shared/types';
import type { ProviderProfilesState } from '$store/renderer/slices/provider-settings/provider-settings-types';
import {
  initialAgentPlacement,
  resolveStartOn,
  START_ON_BACKEND,
  START_ON_E2B,
  startOnCloudId,
  startOnOptions,
  startOnVisible,
  type StartOnCloudEntry,
} from '$features/remote-machines/start-on';
import {
  agentMachineChipLabel,
  agentMachineLocation,
  agentPlacementNoticeKind,
  placementFailure,
} from '$features/remote-machines/agent-location';
import {
  E2B_PROVIDER,
  E2B_SANDBOXES,
  TEAM_ENTRY,
  TEAM_SANDBOXES,
  setupCloudMachinesFixture,
} from '../../test/cloud-machines-preview';
import { remoteMachinesLoaded } from '$features/remote-machines/remote-machines-slice';
import {
  selectEffectiveStartOn,
  selectRemoteMachine,
  selectStartOnOptions,
} from '$features/remote-machines/remote-machines-selectors';
import { setLabsCloudMachinesEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { cloudProfileBlockReason } from './cloud-machines-selectors';
import {
  cloudErrorText,
  formatUptime,
  liveRunningSeconds,
  sandboxLabel,
} from './cloud-machines-format';

describe('wire parsing', () => {
  it('drops a key the backend must never send, and unknown providers', () => {
    const provider = parseCloudMachineProvider({ ...E2B_PROVIDER, apiKey: 'e2b_sk_x' });
    expect(provider).not.toHaveProperty('apiKey');
    expect(parseCloudMachineProvider({ ...E2B_PROVIDER, provider: 'modal' })).toBeNull();
  });

  it('reads named entries, and an older row without provider only as the entry "e2b"', () => {
    expect(parseCloudMachineProvider(TEAM_ENTRY)).toEqual(TEAM_ENTRY);
    const { provider: _kind, ...legacy } = E2B_PROVIDER;
    expect(parseCloudMachineProvider(legacy)).toEqual(E2B_PROVIDER);
    expect(parseCloudMachineProvider({ ...legacy, id: TEAM_ENTRY.id })).toBeNull();
    const { cloudMachineId: _id, ...oldCloud } = E2B_SANDBOXES[0]!.cloud!;
    expect(
      parseRemoteMachine({ ...E2B_SANDBOXES[0], cloud: oldCloud })?.cloud?.cloudMachineId,
    ).toBe('e2b');
    expect(parseRemoteMachine(TEAM_SANDBOXES[0])?.cloud?.cloudMachineId).toBe(TEAM_ENTRY.id);
  });

  it('keeps only known, well-formed sizes and defaults the saved size', () => {
    const provider = parseCloudMachineProvider({
      ...E2B_PROVIDER,
      size: '3x5',
      sizes: [
        { id: '2x4', vcpu: 2, memoryMiB: 4096, plan: 'hobby' },
        { id: '64x1', vcpu: 64 },
      ],
    });
    expect(provider?.size).toBe('4x8');
    expect(provider?.sizes.map((size) => size.id)).toEqual(['2x4']);
  });

  it('reads the cloud field of a sandbox row and nothing for an exposed machine', () => {
    expect(parseRemoteMachine(E2B_SANDBOXES[0])?.cloud?.startedBy.displayName).toBe('Clément');
    expect(parseRemoteMachine({ ...E2B_SANDBOXES[0], cloud: { provider: 'e2b' } })?.cloud).toBe(
      undefined,
    );
  });

  it('parses the three cloud error codes and ignores others', () => {
    expect(
      parseCloudMachineError({ code: 'cloud-quota', limit: 'plan', retryable: false }),
    ).toEqual({
      code: 'cloud-quota',
      limit: 'plan',
      retryable: false,
    });
    expect(
      parseCloudMachineError({ code: 'cloud-profile-required', providerRef: 'claude-code' }),
    ).toEqual({ code: 'cloud-profile-required', providerRef: 'claude-code' });
    expect(parseCloudMachineError({ code: 'machine-in-use' })).toBeNull();
  });

  it('accepts target e2b only as a bare isolated placement', () => {
    expect(AgentPlacementRequestSchema.safeParse({ target: 'e2b' }).success).toBe(true);
    expect(
      AgentPlacementRequestSchema.safeParse({ target: 'e2b', checkout: 'isolated' }).success,
    ).toBe(true);
    expect(AgentPlacementRequestSchema.safeParse({ target: 'e2b', nodeId: 'x' }).success).toBe(
      false,
    );
    expect(AgentPlacementRequestSchema.safeParse({ target: 'e2b', os: 'linux' }).success).toBe(
      false,
    );
    expect(
      AgentPlacementRequestSchema.safeParse({ target: 'e2b', checkout: 'shared' }).success,
    ).toBe(false);
  });

  it('accepts cloudMachineId only with target e2b', () => {
    expect(
      AgentPlacementRequestSchema.safeParse({ target: 'e2b', cloudMachineId: TEAM_ENTRY.id })
        .success,
    ).toBe(true);
    expect(
      AgentPlacementRequestSchema.safeParse({
        target: 'remote',
        checkout: 'isolated',
        nodeId: 'd-mac',
        cloudMachineId: 'e2b',
      }).success,
    ).toBe(false);
    expect(AgentPlacementRequestSchema.safeParse({ cloudMachineId: 'e2b' }).success).toBe(false);
  });

  it('keeps an e2b agent projection, including a linked sandbox and cloudStart', () => {
    const parsed = AgentNodeFieldsSchema.parse({
      nodeId: 'sb-1',
      nodeName: 'E2B',
      placement: { target: 'e2b', checkout: 'isolated' },
      cloudStart: { step: 'connecting' },
    });
    expect(parsed.placement?.target).toBe('e2b');
    expect(parsed.cloudStart?.step).toBe('connecting');
  });
});

describe('cost and uptime', () => {
  it('estimates from E2B rates and advances only while running', () => {
    expect(estimateCloudCost('4x8', 3600)).toBeCloseTo(0.3312, 4);
    expect(estimateCloudCost('weird', 3600)).toBeNull();
    const running = E2B_SANDBOXES[0]!;
    const paused = E2B_SANDBOXES[2]!;
    expect(liveRunningSeconds(running, 1000, 61_000)).toBe(42 * 60 + 60);
    expect(liveRunningSeconds(paused, 1000, 61_000)).toBe(17 * 60);
    expect(formatUptime(72 * 60)).toBe(
      m.cloudMachines_uptime_hoursMinutes({ hours: '1', minutes: '12' }),
    );
    expect(formatUptime(30)).toBe(m.cloudMachines_uptime_underMinute());
    expect(sandboxLabel(running)).toBe('iOS build fixer');
    expect(sandboxLabel(TEAM_SANDBOXES[0]!, TEAM_ENTRY.name)).toBe('Release notes');
  });
});

describe('Start On', () => {
  const machines = [{ ...E2B_SANDBOXES[0]!, id: 'd-mac', name: 'Mac', cloud: undefined }];
  const entry = (cloudMachineId: string, unavailableReason: string | null = null) =>
    ({ cloudMachineId, label: `E2B · ${cloudMachineId}`, unavailableReason }) as StartOnCloudEntry;

  it('adds one row per entry after the machines, with the profile hint', () => {
    const options = startOnOptions({
      backendLabel: 'Box',
      machines,
      cloud: [entry('e2b'), entry(TEAM_ENTRY.id, 'key rejected')],
    });
    expect(options.slice(-2)).toMatchObject([
      { id: START_ON_E2B, label: 'E2B · e2b', kind: 'cloud', disabled: false },
      {
        id: startOnCloudId(TEAM_ENTRY.id),
        kind: 'cloud',
        disabled: true,
        reason: 'key rejected',
      },
    ]);
    expect(options.at(-2)?.hint).toBeTruthy();
    expect(
      startOnOptions({ backendLabel: 'Box', machines, cloud: [] }).some((o) => o.kind === 'cloud'),
    ).toBe(false);
  });

  it('shows with E2B alone, and falls back to the backend when an entry cannot run the model', () => {
    const cloud = [entry('e2b'), entry(TEAM_ENTRY.id, 'needs a key')];
    expect(
      startOnVisible({ remoteMachinesVisible: true, supported: true, machines: [], cloud }),
    ).toBe(true);
    expect(resolveStartOn(START_ON_E2B, [], cloud)).toBe(START_ON_E2B);
    expect(resolveStartOn(startOnCloudId(TEAM_ENTRY.id), [], cloud)).toBe(START_ON_BACKEND);
    expect(resolveStartOn(startOnCloudId('e2b-gone'), [], cloud)).toBe(START_ON_BACKEND);
    expect(resolveStartOn(START_ON_E2B, [], null)).toBe(START_ON_BACKEND);
  });

  it('names the entry in the placement only when the backend keeps entries', () => {
    expect(initialAgentPlacement(START_ON_E2B)).toEqual({ target: 'e2b', checkout: 'isolated' });
    expect(initialAgentPlacement(startOnCloudId(TEAM_ENTRY.id), { cloudEntries: true })).toEqual({
      target: 'e2b',
      checkout: 'isolated',
      cloudMachineId: TEAM_ENTRY.id,
    });
    expect(initialAgentPlacement('d-mac', { cloudEntries: true })).toEqual({
      target: 'remote',
      checkout: 'isolated',
      nodeId: 'd-mac',
    });
  });
});

describe('which configurations can run on E2B', () => {
  const env = (set: boolean) =>
    set
      ? [{ key: 'ANTHROPIC_API_KEY', kind: 'set' as const, value: '••••' }]
      : [{ key: 'X', kind: 'unset' as const }];

  function seed(profiles: Partial<ProviderProfilesState>) {
    store.init();
    store.dispatch(backendReconnected());
    const state = store.state as unknown as {
      cloudMachines: { providers: Record<string, unknown> };
      providerSettings: { profiles: ProviderProfilesState };
    };
    state.cloudMachines.providers = { e2b: E2B_PROVIDER };
    state.providerSettings.profiles = { ...state.providerSettings.profiles, ...profiles };
  }

  beforeEach(() => seed({}));

  it('blocks a Default with no overrides once the profile list is read', () => {
    seed({ loadStatus: 'success', defaults: {} });
    expect(cloudProfileBlockReason(store.state, 'claude-code')).toBeTruthy();
  });

  it('lets the daemon decide while the profile list is unknown', () => {
    seed({ loadStatus: 'idle', defaults: {} });
    expect(cloudProfileBlockReason(store.state, 'claude-code')).toBeNull();
  });

  it('allows a Default that sets a key, and blocks one that only unsets', () => {
    const base = { baseProviderId: 'claude-code', name: 'Default' };
    seed({ loadStatus: 'success', defaults: { 'claude-code': { ...base, env: env(true) } } });
    expect(cloudProfileBlockReason(store.state, 'claude-code')).toBeNull();
    seed({ loadStatus: 'success', defaults: { 'claude-code': { ...base, env: env(false) } } });
    expect(cloudProfileBlockReason(store.state, 'claude-code')).toBeTruthy();
  });

  it('blocks a provider whose CLI the templates do not install', () => {
    seed({ loadStatus: 'success' });
    expect(cloudProfileBlockReason(store.state, 'gemini')).toBeTruthy();
  });
});

describe('an agent on E2B', () => {
  const agent = (extra: Partial<AgentSession>): AgentSession =>
    ({
      id: 'a1',
      nodeName: 'E2B',
      placement: { target: 'e2b', checkout: 'isolated' },
      ...extra,
    }) as AgentSession;

  it('reads starting, running and paused, and never unreachable while paused', () => {
    expect(
      agentMachineLocation(agent({ cloudStart: { step: 'creating-sandbox' } }))?.cloud?.state,
    ).toBe('starting');
    const running = agentMachineLocation(
      agent({ nodeId: 'sb-1', nodeState: 'offline' }),
      E2B_SANDBOXES[0],
    );
    expect(running?.cloud?.state).toBe('running');
    expect(running?.state).toBe('ready');
    expect(agentMachineChipLabel(running!)).toBe(
      m.cloudMachines_agent_chip({ machine: 'E2B', state: m.cloudMachines_agent_running() }),
    );
    const paused = agentMachineLocation(agent({ nodeId: 'sb-3' }), E2B_SANDBOXES[2]);
    expect(paused?.cloud?.state).toBe('paused');
    expect(agentPlacementNoticeKind(agent({ nodeId: 'sb-3' }), paused)).toBeNull();
  });

  it('shows the starting notice while its sandbox starts', () => {
    const a = agent({ cloudStart: { step: 'connecting' } });
    expect(agentPlacementNoticeKind(a, agentMachineLocation(a))).toBe('starting');
  });

  it('reads cloud start failures in the app words', () => {
    const quota = placementFailure(
      {
        code: 'cloud-quota',
        detail: 'refused {"code":"cloud-quota","provider":"e2b","limit":"plan","retryable":false}',
      },
      'E2B',
    );
    expect(quota.cloud).toMatchObject({ code: 'cloud-quota', limit: 'plan' });
    expect(cloudErrorText(quota.cloud!).description).toBe(
      m.cloudMachines_error_quotaPlan_description(),
    );
    const profile = placementFailure(
      { code: 'cloud-profile-required', detail: 'no profile' },
      'E2B',
    );
    expect(profile.cloud?.code).toBe('cloud-profile-required');
  });

  it('keeps the backend detail when a failure carries only the cloud code', () => {
    const missing = placementFailure(
      { code: 'cloud-machine-unavailable', detail: 'No intent-node template for 0.212.0' },
      'E2B',
    );
    expect(missing.cloud?.code).toBe('cloud-machine-unavailable');
    expect(missing.cloudDetailKnown).toBe(false);
    expect(missing.message).toBe('No intent-node template for 0.212.0');
    const quota = placementFailure(
      { code: 'cloud-quota', detail: 'x {"code":"cloud-quota","limit":"plan","retryable":false}' },
      'E2B',
    );
    expect(quota.cloudDetailKnown).toBe(true);
  });
});

describe('Labs flag', () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it('offers E2B in Start On only while the flag is on', () => {
    store.init();
    restore = setupCloudMachinesFixture('connected');
    store.dispatch(remoteMachinesLoaded({ ...remoteSnapshot(), initialAgentPlacement: true }));
    const hasCloud = () =>
      selectStartOnOptions.select(store.state).some((option) => option.kind === 'cloud');
    expect(hasCloud()).toBe(true);
    store.dispatch(setLabsCloudMachinesEnabled(false));
    expect(hasCloud()).toBe(false);
    expect(selectEffectiveStartOn.select(store.state, START_ON_E2B)).toBe(START_ON_BACKEND);
  });

  it('lists each entry as "E2B · <name>" in Start On', () => {
    store.init();
    restore = setupCloudMachinesFixture('entries');
    store.dispatch(remoteMachinesLoaded({ ...remoteSnapshot(), initialAgentPlacement: true }));
    const cloud = selectStartOnOptions.select(store.state).filter((o) => o.kind === 'cloud');
    expect(cloud.map((o) => [o.id, o.label])).toEqual([
      [START_ON_E2B, m.cloudMachines_startOn_entry_label({ name: 'E2B' })],
      [
        startOnCloudId(TEAM_ENTRY.id),
        m.cloudMachines_startOn_entry_label({ name: 'Team project' }),
      ],
    ]);
  });

  it('still shows an agent already on E2B, with its sandbox state, while the flag is off', () => {
    store.init();
    restore = setupCloudMachinesFixture('labs-off');
    const sandbox = E2B_SANDBOXES[2]!;
    const location = agentMachineLocation(
      {
        id: 'a-paused',
        nodeName: 'E2B',
        nodeId: sandbox.id,
        placement: { target: 'e2b', checkout: 'isolated' },
      } as AgentSession,
      selectRemoteMachine.select(store.state, sandbox.id),
    );
    expect(location?.cloud?.state).toBe('paused');
  });
});

function remoteSnapshot() {
  return {
    supported: true,
    machines: [],
    localFingerprint: null,
    executorBackends: null,
  };
}
