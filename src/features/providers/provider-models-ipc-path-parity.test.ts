/**
 * Main/renderer path parity for the per-provider `<provider>:get-models`
 * channels (cloudlands-fe#3918 bug class). Both paths are live: the Electron
 * renderer reaches the main-process handlers (`provider-models.client.ts`
 * calls `window.electronAPI.invoke` directly), while web/daemon builds reach
 * `model-catalog-bridge-seeder.ts` through the mock IPC router. The same params
 * must produce the same daemon `models.list` request and the same envelope.
 */
import { beforeEach, expect, it, vi } from 'vitest';

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
import { setupAntigravityIPC } from '../antigravity/main/antigravity.ipc';
import { setupAuggieIPC } from '../auggie/main/auggie.ipc';
import { setupClaudeCodeIPC } from '../claude-code/main/claude-code.ipc';
import { setupCodexIPC } from '../codex/main/codex.ipc';
import { setupCortexIPC } from '../cortex/main/cortex.ipc';
import { setupDroidIPC } from '../droid/main/droid.ipc';
import { setupGrokIPC } from '../grok/main/grok.ipc';
import { setupOpencodeIPC } from '../opencode/main/opencode.ipc';
import { setupPiIPC } from '../pi/main/pi.ipc';
import { setupUnslothIPC } from '../unsloth/main/unsloth.ipc';

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
 * The renderer `getProviderModels` call shapes: no params, each field alone,
 * and all together. `providerRef` names a profile of the channel's provider.
 */
function scenarios(providerId: string): Record<string, Record<string, unknown> | undefined> {
  const providerRef = `${providerId}@work`;
  return {
    'no params': undefined,
    'a forced refresh': { forceRefresh: true },
    'a workspace-scoped list': { workspaceId: 'amber-forest' },
    'a named provider profile': { providerRef },
    'every field together': { forceRefresh: true, workspaceId: 'amber-forest', providerRef },
    'forceRefresh: false': { forceRefresh: false },
  };
}

interface Outcome {
  calls: DaemonCall[];
  result: unknown;
}

async function runMain(
  channel: string,
  setup: () => void,
  params: Record<string, unknown> | undefined,
): Promise<Outcome> {
  mocks.handle.mockClear();
  mocks.mainRequest.mockClear();
  setup();
  const call = mocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`main registered no ${channel} handler`);
  const result = await (call[1] as (...args: unknown[]) => Promise<unknown>)(
    { sender: { id: 1 } },
    params,
  );
  return { calls: contractCalls(mocks.mainRequest.mock.calls, CONTRACT_METHODS), result };
}

async function runRenderer(
  channel: string,
  params: Record<string, unknown> | undefined,
): Promise<Outcome> {
  vi.mocked(backendRequest).mockClear();
  const result = await invoke(channel, params);
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

function modelsParity(providerId: string, channel: string, setup: () => void): void {
  it.each(Object.entries(scenarios(providerId)))('%s', async (_name, params) => {
    const main = await runMain(channel, setup, params);
    const renderer = await runRenderer(channel, params);
    expectSameDaemonRequests(channel, main.calls, renderer.calls);
    expect(renderer.result, `${channel}: the two paths built different envelopes`).toEqual(
      main.result,
    );
  });

  it('a daemon failure fails closed with the same envelope on both paths', async () => {
    daemonFails = true;
    const main = await runMain(channel, setup, { forceRefresh: true });
    const renderer = await runRenderer(channel, { forceRefresh: true });
    expect(main.result).toEqual({ success: false, error: 'daemon unreachable' });
    expect(renderer.result).toEqual(main.result);
  });
}

describeParity('antigravity:get-models', () =>
  modelsParity('antigravity', 'antigravity:get-models', setupAntigravityIPC),
);
describeParity('auggie:get-models', () =>
  modelsParity('auggie', 'auggie:get-models', setupAuggieIPC),
);
describeParity('claude-code:get-models', () =>
  modelsParity('claude-code', 'claude-code:get-models', setupClaudeCodeIPC),
);
describeParity('codex:get-models', () => modelsParity('codex', 'codex:get-models', setupCodexIPC));
describeParity('cortex:get-models', () =>
  modelsParity('cortex', 'cortex:get-models', setupCortexIPC),
);
describeParity('droid:get-models', () => modelsParity('droid', 'droid:get-models', setupDroidIPC));
describeParity('grok:get-models', () => modelsParity('grok', 'grok:get-models', setupGrokIPC));
describeParity('opencode:get-models', () =>
  modelsParity('opencode', 'opencode:get-models', setupOpencodeIPC),
);
describeParity('pi:get-models', () => modelsParity('pi', 'pi:get-models', setupPiIPC));
describeParity('unsloth:get-models', () =>
  modelsParity('unsloth', 'unsloth:get-models', setupUnslothIPC),
);
