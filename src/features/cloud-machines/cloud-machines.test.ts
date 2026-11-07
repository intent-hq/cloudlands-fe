/**
 * E2B contracts the app relies on: wire parsing (no key, ever), the Start On
 * row and its placement, which configurations can run on E2B, and how an
 * agent on E2B and its errors read.
 */
import { beforeEach, describe, expect, it } from 'vitest';
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
  startOnOptions,
  startOnVisible,
} from '$features/remote-machines/start-on';
import {
  agentMachineChipLabel,
  agentMachineLocation,
  agentPlacementNoticeKind,
  placementFailure,
} from '$features/remote-machines/agent-location';
import { E2B_PROVIDER, E2B_SANDBOXES } from '../../test/cloud-machines-preview';
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
    expect(parseCloudMachineProvider({ ...E2B_PROVIDER, id: 'modal' })).toBeNull();
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
  });
});

describe('Start On', () => {
  const machines = [{ ...E2B_SANDBOXES[0]!, id: 'd-mac', name: 'Mac', cloud: undefined }];

  it('adds E2B after the machines with the profile hint', () => {
    const options = startOnOptions({
      backendLabel: 'Box',
      machines,
      cloud: { unavailableReason: null },
    });
    expect(options.at(-1)).toMatchObject({ id: START_ON_E2B, kind: 'cloud', disabled: false });
    expect(options.at(-1)?.hint).toBeTruthy();
    expect(
      startOnOptions({ backendLabel: 'Box', machines, cloud: null }).some(
        (o) => o.kind === 'cloud',
      ),
    ).toBe(false);
  });

  it('shows with E2B alone, and falls back to the backend when E2B cannot run the model', () => {
    const cloud = { unavailableReason: null };
    expect(
      startOnVisible({ remoteMachinesVisible: true, supported: true, machines: [], cloud }),
    ).toBe(true);
    expect(resolveStartOn(START_ON_E2B, [], cloud)).toBe(START_ON_E2B);
    expect(resolveStartOn(START_ON_E2B, [], { unavailableReason: 'needs a key' })).toBe(
      START_ON_BACKEND,
    );
    expect(resolveStartOn(START_ON_E2B, [], null)).toBe(START_ON_BACKEND);
  });

  it('sends target e2b for the E2B row', () => {
    expect(initialAgentPlacement(START_ON_E2B)).toEqual({ target: 'e2b', checkout: 'isolated' });
    expect(initialAgentPlacement('d-mac')).toEqual({
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
});
