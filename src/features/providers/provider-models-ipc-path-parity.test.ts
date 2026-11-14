/**
 * Main/renderer path parity for the shared `providers:get-models` channel
 * (cloudlands-fe#3918 bug class). Both paths are live: the Electron renderer
 * reaches the main-process handler (`provider-models.client.ts` calls
 * `window.electronAPI.invoke` directly), while web/daemon builds reach
 * `model-catalog-bridge-seeder.ts` through the mock IPC router. The same params
 * must produce the same daemon `models.list` request and the same envelope for
 * every provider, including one the app has never heard of
 * (intent-hq/intent#9253: Cursor shipped with no route on one path).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  mainRequest: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    getAppPath: vi.fn(() => '/tmp/app'),
    getPath: vi.fn(() => '/tmp'),
    getVersion: vi.fn(() => '0.0.0'),
    getName: vi.fn(() => 'Intent'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromId: vi.fn(),
    getFocusedWindow: vi.fn(() => undefined),
    fromWebContents: vi.fn(() => undefined),
  },
  ipcMain: { handle: mocks.handle, removeHandler: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

vi.mock('$features/backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mocks.mainRequest }),
  getBackendClientForIpcEvent: () => ({ client: { request: mocks.mainRequest } }),
}));

// test-setup stubs the bridge globally; parity needs the real invoke hop.
vi.mock('$lib/electron-bridge', async (importOriginal) => importOriginal());

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import '$store/renderer/seeders/model-catalog-bridge-seeder';
import {
  contractCalls,
  describeParity,
  expectSameDaemonRequests,
  type DaemonCall,
} from '../../test/ipc-path-parity';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import { PROVIDER_AVAILABILITY_KEY_TO_ID } from '$shared/types/provider-availability';
import { setupProviderModelsIPC } from './main/provider-models.ipc';

const CHANNEL = PROVIDERS_CHANNELS.GET_MODELS;
const CONTRACT_METHODS = ['models.list'] as const;

const MODELS_LIST_RESULT = {
  models: [{ id: 'model-a', name: 'Model A' }],
  warning: 'probe degraded',
  stale: true,
};

let daemonFails = false;

async function daemon(method: string): Promise<unknown> {
  if (daemonFails) throw new Error('daemon unreachable');
  return method === 'models.list' ? MODELS_LIST_RESULT : {};
}

/**
 * The renderer `getProviderModels` call shapes: no options, each field alone,
 * and all together. `providerRef` names a profile of the requested provider.
 */
function scenarios(providerId: string): Record<string, Record<string, unknown>> {
  const providerRef = `${providerId}@work`;
  return {
    'no options': { providerId },
    'a forced refresh': { providerId, forceRefresh: true },
    'a workspace-scoped list': { providerId, workspaceId: 'amber-forest' },
    'a named provider profile': { providerId, providerRef },
    'every field together': {
      providerId,
      forceRefresh: true,
      workspaceId: 'amber-forest',
      providerRef,
    },
    'forceRefresh: false': { providerId, forceRefresh: false },
    "another provider's profile": { providerId, providerRef: 'other-provider@work' },
  };
}

interface Outcome {
  calls: DaemonCall[];
  result: unknown;
}

async function runMain(params: unknown): Promise<Outcome> {
  mocks.handle.mockClear();
  mocks.mainRequest.mockClear();
  setupProviderModelsIPC();
  const call = mocks.handle.mock.calls.find(([registered]) => registered === CHANNEL);
  if (!call) throw new Error(`main registered no ${CHANNEL} handler`);
  const result = await (call[1] as (...args: unknown[]) => Promise<unknown>)(
    { sender: { id: 1 } },
    params,
  );
  return { calls: contractCalls(mocks.mainRequest.mock.calls, CONTRACT_METHODS), result };
}

async function runRenderer(params: unknown): Promise<Outcome> {
  vi.mocked(backendRequest).mockClear();
  const result = await invoke(CHANNEL, params);
  return {
    calls: contractCalls(vi.mocked(backendRequest).mock.calls, CONTRACT_METHODS),
    result,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  daemonFails = false;
  mocks.mainRequest.mockImplementation(daemon);
  vi.mocked(backendRequest).mockImplementation(daemon as typeof backendRequest);
});

const PROVIDER_IDS = [
  ...Object.values(PROVIDER_AVAILABILITY_KEY_TO_ID).filter((id) => id !== 'mock'),
  'provider-added-later',
];

describeParity(PROVIDERS_CHANNELS.GET_MODELS, () => {
  describe.each(PROVIDER_IDS)('%s', (providerId) => {
    it.each(Object.entries(scenarios(providerId)))('%s', async (_name, params) => {
      const main = await runMain(params);
      const renderer = await runRenderer(params);
      expectSameDaemonRequests(CHANNEL, main.calls, renderer.calls);
      expect(main.calls[0]?.[1]).toMatchObject({
        providerId: params.providerRef === `${providerId}@work` ? `${providerId}@work` : providerId,
      });
      expect(renderer.result, `${CHANNEL}: the two paths built different envelopes`).toEqual(
        main.result,
      );
    });
  });

  it('a daemon failure fails closed with the same envelope on both paths', async () => {
    daemonFails = true;
    const params = { providerId: 'codex', forceRefresh: true };
    const main = await runMain(params);
    const renderer = await runRenderer(params);
    expect(main.result).toEqual({ success: false, error: 'daemon unreachable' });
    expect(renderer.result).toEqual(main.result);
  });

  it.each([
    ['no params', undefined],
    ['no provider id', { forceRefresh: true }],
    ['an empty provider id', { providerId: '' }],
    ['a non-string provider id', { providerId: 42 }],
  ])('rejects %s on both paths without calling the daemon', async (_name, params) => {
    const main = await runMain(params);
    const renderer = await runRenderer(params);
    expect(main.calls).toEqual([]);
    expect(renderer.calls).toEqual([]);
    expect(main.result).toMatchObject({ success: false });
    expect(renderer.result).toEqual(main.result);
  });
});
