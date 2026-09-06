import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { appClient } from '$lib/client';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { toast } from 'svelte-sonner';
import { startRootStoreLifecycle } from './root-store-lifecycle';
import { store as appStore } from './store';
import { startAllAppSagas } from './sagas';
import {
  pinWorkspaceToKey,
  pttRecordingFinished,
  setActionKeyMapping,
  setPromptPickerLimit,
} from './slices/hardware-console/hardware-console-slice';
import { sendMessage } from './slices/chat-state/chat-state-slice';
import { openWorkspaceTab } from './slices/tab-state/tab-state-slice';

const hardware = vi.hoisted(() => {
  const statusListeners = new Set<(status: string) => void>();
  const rawListeners = new Set<(message: unknown) => void>();
  const ipcListeners = new Map<string, (...args: unknown[]) => void>();
  const statusState = { value: 'disconnected' };
  const client = {
    call: vi.fn(async (method: string) => {
      if (method === 'sys.version') return { version: 'v0.6.0' };
      if (method === 'device.status') return { battery: 87, is_charging: true };
      if (method === 'fs.read') return { data: JSON.stringify({ layers: [['KV_OAI_AGENT_1']] }) };
      return { ok: 1 };
    }),
  };
  const manager = {
    get status() {
      return statusState.value;
    },
    get connectedDevice() {
      return statusState.value === 'connected'
        ? { model: 'creator-micro-2', name: 'Composition Console' }
        : null;
    },
    get client() {
      return statusState.value === 'connected' ? client : null;
    },
    start: vi.fn(async () => {
      statusState.value = 'connected';
      for (const listener of statusListeners) listener('connected');
    }),
    stop: vi.fn(async () => {
      statusState.value = 'disconnected';
      for (const listener of statusListeners) listener('disconnected');
    }),
    onStatusChange: vi.fn((listener: (status: string) => void) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    }),
    onRawMessage: vi.fn((listener: (message: unknown) => void) => {
      rawListeners.add(listener);
      return () => rawListeners.delete(listener);
    }),
    connectedCollections: vi.fn(async () => [{ usagePage: 1, usage: 6 }]),
  };
  const ipc = {
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      ipcListeners.set(channel, listener);
      return `listener-${channel}`;
    }),
    offById: vi.fn(),
    send: vi.fn(),
  };
  return {
    manager,
    client,
    ipc,
    emitRaw: (message: unknown) => {
      for (const listener of rawListeners) listener(message);
    },
    emitIpc: (channel: string) => ipcListeners.get(channel)?.(),
    reset: () => {
      statusState.value = 'disconnected';
      statusListeners.clear();
      rawListeners.clear();
      ipcListeners.clear();
      vi.clearAllMocks();
    },
  };
});

vi.mock('$features/hardware-console/instance', () => ({
  getHardwareConsoleManager: () => hardware.manager,
}));
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: vi.fn(async () => undefined) }));
vi.mock('svelte-sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const settingsBag = {
  enabled: true,
  keyPins: ['ws-1'],
  excludedWorkspaceIds: [],
  promptUsage: [{ text: 'Open dashboard', count: 1, lastUsedAt: '2026-01-01T00:00:00.000Z' }],
  promptPickerLimit: 4,
  actionMappingByModel: {
    'creator-micro-2': ['new-workspace', 'none', 'none', 'none', 'none', 'none'],
  },
  cycleScopeByFamily: {},
};

const settingsGet = vi.spyOn(appClient.settings, 'get');
const settingsUpdate = vi.spyOn(appClient.settings, 'update');

let dispose: (() => void) | undefined;

beforeEach(() => {
  window.history.replaceState({}, '', '/workspace/ws-1');
  hardware.reset();
  settingsGet.mockResolvedValue({ path: 'hardwareConsole.state', value: settingsBag } as never);
  settingsUpdate.mockResolvedValue([]);
  const invoke = vi.fn(async (channel: string) => {
    // Owner-status query (#1928): with a bridge present the saga flips
    // pessimistically to non-owner until main answers — answer as owner.
    if (channel === 'hardware-console:get-owner-status') return { isOwner: true };
    return {
      ok: true,
      result: { text: 'Transcribed composition prompt', provider: 'elevenlabs', durationMs: 900 },
    };
  });
  const bridge = {
    invoke,
    on: hardware.ipc.on,
    offById: hardware.ipc.offById,
    send: hardware.ipc.send,
  };
  vi.stubGlobal('electronAPI', bridge);
  (window as unknown as { electronAPI: typeof bridge }).electronAPI = bridge;
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('hardware-console production composition', () => {
  it('runs the root lifecycle across device I/O, persistence, prompts, feedback, shutdown, and voice', async () => {
    dispose = startRootStoreLifecycle(appStore, {
      startSagas: startAllAppSagas,
    });

    await vi.waitFor(() => expect(hardware.manager.start).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(appStore.state.hardwareConsole.isConsoleOwner).toBe(true));
    await vi.waitFor(() => expect(appStore.state.hardwareConsole.promptsHydrated).toBe(true));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(hardware.client.call).toHaveBeenCalledWith('v.oai.thstatus', expect.any(Array)),
    );
    expect(hardware.client.call).toHaveBeenCalledWith('v.oai.rgbcfg', expect.any(Object));

    hardware.emitRaw({ m: 'v.oai.hid', p: { k: 'ACT06', act: 1 } });
    await vi.waitFor(() =>
      expect(navigateToRoute).toHaveBeenCalledWith(
        expect.stringMatching(/^\/workspace\/new\?instance=/),
      ),
    );

    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();
    hardware.emitRaw({ a: 0.5, d: 1 });
    await vi.waitFor(() => expect(appStore.state.hardwareConsole.radialPrompt.open).toBe(true));
    hardware.emitRaw({ a: 0.5, d: 0 });
    await vi.waitFor(() => expect(input.value).toContain('Open dashboard'));
    expect(appStore.state.hardwareConsole.radialPrompt.open).toBe(false);

    appStore.dispatch(pinWorkspaceToKey(0, 'ws-1'));
    appStore.dispatch(setActionKeyMapping('creator-micro-2', 0, 'new-workspace'));
    appStore.dispatch(setPromptPickerLimit(2));
    appStore.dispatch(sendMessage('agent-a', { text: 'Persist this prompt', wsId: 'ws-1' }));
    // Other boot-time sagas can persist earlier (e.g. the setup-prompt saga's
    // workspace refresh triggers a key-pin reconcile persist), so wait for the
    // four dispatched persists specifically rather than the first call.
    await vi.waitFor(() =>
      expect(settingsUpdate.mock.calls.flat(2)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: expect.objectContaining({ keyPins: expect.any(Array) }),
          }),
          expect.objectContaining({
            value: expect.objectContaining({ actionMappingByModel: expect.any(Object) }),
          }),
          expect.objectContaining({ value: expect.objectContaining({ promptPickerLimit: 2 }) }),
          expect.objectContaining({
            value: expect.objectContaining({
              promptUsage: expect.arrayContaining([
                expect.objectContaining({ text: 'Persist this prompt' }),
              ]),
            }),
          }),
        ]),
      ),
    );

    hardware.emitIpc(IPC_CHANNELS.HARDWARE_CONSOLE.CLEAR_LIGHTING);
    await vi.waitFor(() =>
      expect(hardware.ipc.send).toHaveBeenCalledWith(
        IPC_CHANNELS.HARDWARE_CONSOLE.CLEAR_LIGHTING_DONE,
      ),
    );
    expect(hardware.client.call).toHaveBeenCalledWith('v.oai.thstatus', expect.any(Array));

    const invoke = (window as unknown as { electronAPI: { invoke: ReturnType<typeof vi.fn> } })
      .electronAPI.invoke;
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.history.replaceState({}, '', '/workspace/ws-2');
    appStore.dispatch(openWorkspaceTab('ws-1'));
    appStore.dispatch(
      pttRecordingFinished({
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 900,
        stopReason: 'manual',
        autoSend: false,
      }),
    );
    await vi.waitFor(() => {
      if (
        !invoke.mock.calls.some(
          ([channel, request]) =>
            channel === IPC_CHANNELS.BACKEND.REQUEST && request?.method === 'voice.transcribe',
        )
      ) {
        throw new Error('voice.transcribe request not observed yet');
      }
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, {
      method: 'voice.transcribe',
      params: { audio: 'AQID', mimeType: 'audio/webm', workspaceId: 'ws-1' },
      timeoutMs: 120_000,
    });
    await vi.waitFor(() => expect(input.value).toContain('Transcribed composition prompt'));

    dispose();
    dispose = undefined;
    await vi.waitFor(() => expect(hardware.manager.stop).toHaveBeenCalled());
    expect(hardware.ipc.offById).toHaveBeenCalledWith(
      IPC_CHANNELS.HARDWARE_CONSOLE.CLEAR_LIGHTING,
      expect.any(String),
    );
  });
});
