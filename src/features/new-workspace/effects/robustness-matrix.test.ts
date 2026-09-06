import { runSaga } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppClient } from '$lib/client';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { m } from '$shared/paraglide/messages.js';
import type { ProviderStatus } from '$shared/types/provider-availability';
import type { WorkspaceDraft } from '$shared/types';
import type { StoreState } from '$store/renderer/types';
import {
  daemonHealthReducer,
  initialState as daemonHealthInitialState,
  systemStatusSuccess,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { selectDaemonHostRepairTarget } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import type { SystemStatusWirePayload } from '$store/renderer/slices/daemon-health/daemon-health-types';

import {
  createInitialControllerState,
  effectsFor,
  hasUnsavedInput,
  reduce,
  type Capability,
  type ControllerState,
} from '../controller';
import { DEFAULT_SCENARIO_FIXTURES } from '../sandbox/scenarios';
import { READY_CAPABILITIES, restoredState } from '../sandbox/scenario-builders';
import { formatDaemonHostRepairTarget } from '../ui/host-repair-target';
import { coordinatorStateFor, isEditorEnabled } from '../ui/types';
import { newWorkspaceEffectSaga, type NewWorkspaceSagaDependencies } from '.';

const GENERATION = 12;
const ATTACHMENT = { id: 'staged-file', type: 'file', label: 'plan.txt', sourcePath: '/plan' };

function draft(overrides: Partial<WorkspaceDraft> = {}): WorkspaceDraft {
  return {
    ...DEFAULT_SCENARIO_FIXTURES.draft,
    ownerClientId: 'matrix-client',
    intentText: 'Retain this plan',
    attachments: [ATTACHMENT],
    ...overrides,
  };
}

function editable(
  capability: Capability,
  status: ControllerState['capabilities'][Capability] = 'pending',
): ControllerState {
  return restoredState(draft(), { ...READY_CAPABILITIES, [capability]: status }, GENERATION);
}

async function execute(
  state: ControllerState,
  reduxState: Record<string, unknown> = {},
  dependencies: Partial<NewWorkspaceSagaDependencies> = {},
): Promise<ControllerState> {
  let current = state;
  await runSaga({ getState: () => reduxState }, newWorkspaceEffectSaga, current, {
    client: {} as AppClient,
    getState: () => current,
    dispatch: (event) => {
      current = reduce(current, event);
    },
    ...dependencies,
  }).toPromise();
  return current;
}

function providerReduxState(statuses: Record<string, ProviderStatus>, checked: boolean) {
  return {
    agentAvailability: {
      providerStatusMap: statuses,
      hasCheckedOnce: checked,
    },
  };
}

function systemStatusFixture(os: string, arch: string): SystemStatusWirePayload {
  return {
    running: true,
    listenMode: 'uds',
    transports: ['uds'],
    clients: 1,
    agents: 0,
    protocolVersion: '2.6',
    host: { os, arch, hasDisplay: true, locality: 'local' },
  };
}

function healthStateFor(os: string, arch: string) {
  const currentGeneration = (
    daemonHealthInitialState as typeof daemonHealthInitialState & { connectionGeneration?: number }
  ).connectionGeneration;
  const successForCurrentConnection = systemStatusSuccess as unknown as (
    payload: SystemStatusWirePayload,
    receivedAt: string,
    connectionGeneration?: number,
  ) => ReturnType<typeof systemStatusSuccess>;
  return daemonHealthReducer(
    daemonHealthInitialState,
    successForCurrentConnection(
      systemStatusFixture(os, arch),
      '2026-09-05T00:00:00.000Z',
      currentGeneration,
    ),
  );
}

describe('new-workspace host × provider × network robustness matrix', () => {
  const originalInvoke = window.electronAPI!.invoke;

  beforeEach(() => {
    resetMockIpcRouter();
    window.electronAPI!.invoke = vi.fn((channel: string, payload?: unknown) =>
      mockInvoke(channel, payload),
    );
  });

  afterEach(() => {
    window.electronAPI!.invoke = originalInvoke;
    resetMockIpcRouter();
  });

  it.each([
    ['Git missing', 'git', false],
    ['Node absent', 'node', false],
    ['Node too old', 'node', false],
  ] as const)(
    '%s host fixture preserves the draft while probing %s',
    async (_host, capability, available) => {
      const requests: unknown[] = [];
      registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (payload) => {
        requests.push(payload);
        return { ok: true, result: { available } };
      });
      let state = editable(capability);
      state = reduce(state, { type: 'start.requested', requiredCapabilities: [capability] });

      state = await execute(state);

      expect(requests).toEqual([
        {
          method: capability === 'git' ? 'host.checkGit' : 'host.checkNode',
          params: {},
        },
      ]);
      expect(state.input).toMatchObject({
        intentText: 'Retain this plan',
        attachments: [ATTACHMENT],
      });
      expect(coordinatorStateFor(state)).not.toBe('live');
      expect(state.capabilities[capability]).toBe(available ? 'ready' : 'missing');
    },
  );

  it.each([
    ['macOS Intel', 'macos', 'x86_64'],
    ['macOS ARM', 'macos', 'aarch64'],
    ['Windows', 'windows', 'x86_64'],
    ['Linux', 'linux', 'aarch64'],
  ] as const)(
    '%s system.status fixture selects truthful missing-Git guidance and preserves the draft',
    async (_name, os, arch) => {
      const healthState = healthStateFor(os, arch);
      const repairTarget = selectDaemonHostRepairTarget.select({
        daemonHealth: healthState,
      } as unknown as StoreState);
      const hostGuidanceTarget = formatDaemonHostRepairTarget(repairTarget);
      registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, () => ({
        ok: true,
        result: { available: false },
      }));
      let state = editable('git');
      state = reduce(state, { type: 'start.requested', requiredCapabilities: ['git'] });

      state = await execute(state);

      expect(repairTarget).toEqual({ os, arch });
      expect(hostGuidanceTarget).not.toBe(m.newWorkspace_capabilities_defaultHost_label());
      expect(
        m.newWorkspace_capabilities_repairOnHost_description({
          capability: 'Git',
          host: hostGuidanceTarget,
        }),
      ).toContain(hostGuidanceTarget);
      expect(state.capabilities.git).toBe('missing');
      expect(state.input).toMatchObject({
        intentText: 'Retain this plan',
        attachments: [ATTACHMENT],
      });
      expect(coordinatorStateFor(state)).not.toBe('live');
    },
  );

  it('host fixtures produce distinct localized repair targets', () => {
    const repairTargets = [
      ['macos', 'x86_64'],
      ['macos', 'aarch64'],
      ['windows', 'x86_64'],
      ['linux', 'aarch64'],
    ].map(([os, arch]) => {
      const healthState = healthStateFor(os, arch);
      const host = selectDaemonHostRepairTarget.select({
        daemonHealth: healthState,
      } as unknown as StoreState);
      return formatDaemonHostRepairTarget(host);
    });

    expect(new Set(repairTargets).size).toBe(repairTargets.length);
  });

  it('native provider remains startable when Node is absent', () => {
    let state = editable('node', 'missing');
    state = reduce(state, { type: 'start.requested', requiredCapabilities: ['provider'] });
    expect(state.phase).toBe('promoting');
    expect(state.input.attachments).toEqual([ATTACHMENT]);
  });

  it('npx provider blocks only on its Node dependency', () => {
    let state = editable('node', 'missing');
    state = reduce(state, {
      type: 'start.requested',
      requiredCapabilities: ['provider', 'node'],
    });
    expect(state).toMatchObject({
      phase: 'starting',
      capabilities: { provider: 'ready', node: 'missing' },
    });
    expect(isEditorEnabled(state)).toBe(true);
  });

  it('PATH changed after login re-probes host tools without erasing input', async () => {
    registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, () => ({
      ok: true,
      result: { available: true },
    }));
    let state = editable('git', 'missing');
    state = reduce(state, {
      type: 'capabilities.recheckRequested',
      capabilities: ['git'],
    });
    expect(effectsFor(state)).toEqual([
      { type: 'probeCapability', generation: GENERATION, capability: 'git' },
    ]);

    state = await execute(state);

    expect(state.capabilities.git).toBe('ready');
    expect(state.input).toMatchObject({
      intentText: 'Retain this plan',
      attachments: [ATTACHMENT],
    });
    expect(hasUnsavedInput(state)).toBe(false);
  });

  it.each([
    ['no providers', {}, true, 'missing'],
    [
      'installed unauthenticated',
      { auggie: { available: true, authenticated: false } },
      true,
      'missing',
    ],
    ['authentication not checked', { antigravity: { available: true } }, false, 'unknown'],
    [
      'authentication failed',
      { antigravity: { available: true, authenticated: false } },
      true,
      'missing',
    ],
    [
      'multiple ready providers',
      { auggie: { available: true }, codex: { available: true, authenticated: true } },
      true,
      'ready',
    ],
  ] as const)(
    '%s provider fixture remains truthful without a passive test prompt',
    async (_name, statuses, checked, expected) => {
      let state = editable('provider');
      state = reduce(state, { type: 'start.requested', requiredCapabilities: ['provider'] });

      state = await execute(state, providerReduxState(statuses, checked));

      expect(state.capabilities.provider).toBe(expected);
      expect(state.input).toMatchObject({
        intentText: 'Retain this plan',
        attachments: [ATTACHMENT],
      });
      expect(coordinatorStateFor(state)).not.toBe('live');
      expect(effectsFor(editable('provider', expected))).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'sendFirstMessage' })]),
      );
    },
  );

  it('ready provider expiry blocks execution without clearing draft input', () => {
    let state = editable('provider', 'ready');
    state = reduce(state, {
      type: 'capability.result',
      generation: GENERATION,
      capability: 'provider',
      status: 'missing',
    });
    expect(state.capabilities.provider).toBe('missing');
    expect(state.input.attachments).toEqual([ATTACHMENT]);
    expect(coordinatorStateFor(state)).toBe('connect-provider');
  });

  it('setup-card state changes leave the editor reachable and its value intact', () => {
    let state = editable('provider', 'missing');
    for (const status of ['pending', 'unknown', 'missing', 'ready'] as const) {
      state = reduce(state, {
        type: 'capability.result',
        generation: GENERATION,
        capability: 'provider',
        status,
      });
      expect(isEditorEnabled(state)).toBe(true);
      expect(state.input).toMatchObject({
        intentText: 'Retain this plan',
        attachments: [ATTACHMENT],
      });
    }
  });

  it('unavailable saved model remains saved and reports provider repair without identity swap', () => {
    const saved = draft({ config: { model: 'removed-provider/removed-model' } });
    let state = restoredState(saved, READY_CAPABILITIES, GENERATION);
    state = reduce(state, { type: 'start.requested', requiredCapabilities: ['provider'] });
    state = reduce(state, {
      type: 'operation.failed',
      generation: GENERATION,
      kind: 'promote',
      error: 'Saved model is unavailable; choose a provider model',
    });
    expect(state).toMatchObject({
      phase: 'failed',
      kind: 'promote',
      input: { config: { model: 'removed-provider/removed-model' } },
      draftId: saved.id,
    });
    expect(coordinatorStateFor(state)).not.toBe('live');
  });

  it.each([
    ['online', true, 'ready'],
    ['GitHub offline', null, 'unknown'],
  ] as const)(
    '%s network fixture isolates GitHub capability',
    async (_name, available, expected) => {
      registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, () => {
        if (available === null) throw new Error('GitHub network unavailable');
        return { ok: true, result: { available } };
      });
      let state = editable('github');
      state = reduce(state, { type: 'start.requested', requiredCapabilities: ['github'] });
      state = await execute(state);
      expect(state.capabilities.github).toBe(expected);
      expect(state.capabilities.provider).toBe('ready');
      expect(state.input.source).toBe(draft().source);
    },
  );

  it('provider offline does not masquerade as a daemon or GitHub failure', async () => {
    let state = editable('provider');
    state = reduce(state, { type: 'start.requested', requiredCapabilities: ['provider'] });
    state = await execute(state, providerReduxState({}, false));
    expect(state).toMatchObject({
      phase: 'starting',
      capabilities: { provider: 'unknown', github: 'ready' },
    });
  });

  it('daemon disconnected is unsaved while preserving staged input', async () => {
    const initial = createInitialControllerState(GENERATION, {
      intentText: 'Retain this plan',
      source: null,
      contextLinks: [],
      attachments: [ATTACHMENT],
      config: {},
    });
    const state = await execute(initial, {}, { client: {} as AppClient });
    expect(state).toMatchObject({
      phase: 'offline',
      unsavedInput: { intentText: 'Retain this plan', attachments: [ATTACHMENT] },
    });
    expect(coordinatorStateFor(state)).toBe('daemon-offline');
  });
});
