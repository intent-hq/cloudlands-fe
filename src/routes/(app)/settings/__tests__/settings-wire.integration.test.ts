/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveAppClient } from '$lib/client';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  SETTINGS_PROTOCOL_FIXTURES,
  SHIPPED_WEBSOCKET_SETTING_FIXTURES,
  UNDOCUMENTED_SERVER_FIXTURES,
} from './settings-page.fixtures';

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import AgentBackendSettings from '$lib/components/settings/AgentBackendSettings.svelte';
import WebSocketApiSettings from '$lib/components/settings/WebSocketApiSettings.svelte';

type BackendStep = { request: unknown; response: unknown };

describe('Settings deterministic mock-BE contracts', () => {
  const originalInvoke = window.electronAPI!.invoke;
  const client = new LiveAppClient();
  let storeContext: ReduxStoreContext | undefined;

  beforeEach(() => {
    storeContext = initAppStore(appStore);
    resetMockIpcRouter();
    window.electronAPI!.invoke = vi.fn((channel: string, payload?: unknown) =>
      mockInvoke(channel, payload),
    );
  });

  afterEach(() => {
    storeContext?.dispose();
    storeContext = undefined;
    cleanup();
    window.electronAPI!.invoke = originalInvoke;
    resetMockIpcRouter();
  });

  function mockBackend(expected: unknown, result: unknown) {
    registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (payload) => {
      expect(payload).toEqual(expected);
      return { ok: true, result };
    });
  }

  function mockBackendSequence(steps: BackendStep[]) {
    let index = 0;
    registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (payload) => {
      const step = steps[index++];
      expect(step, `unexpected backend request ${JSON.stringify(payload)}`).toBeDefined();
      expect(payload).toEqual(step.request);
      return { ok: true, result: step.response };
    });
    return () => expect(index).toBe(steps.length);
  }

  it('feeds the protocol-shaped settings catalog through the live AppClient', async () => {
    const fixture = SETTINGS_PROTOCOL_FIXTURES.list;
    mockBackend(fixture.request, fixture.response);

    const settings = await client.settings.list();

    expect(settings).toEqual(fixture.response.settings);
    expect(window.electronAPI!.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.BACKEND.REQUEST,
      fixture.request,
    );
  });

  it('pins the Accounts immediate provider write request and applied response', async () => {
    const request = {
      method: 'settings.update',
      params: { changes: [{ path: 'model.defaultProvider', value: 'codex' }] },
    };
    mockBackend(request, { applied: [{ path: 'model.defaultProvider', value: 'codex' }] });

    await expect(
      client.settings.setProviderSettings({ activeProviderId: 'codex' }),
    ).resolves.toEqual({
      success: true,
    });
    expect(window.electronAPI!.invoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, request);
  });

  it('pins the Setup blur/Enter setting read and protocol-shaped definition', async () => {
    const fixture = SETTINGS_PROTOCOL_FIXTURES.maxConcurrent;
    mockBackend(fixture.request, fixture.response);

    await expect(client.settings.get('agents.maxConcurrent')).resolves.toEqual({
      ...fixture.response.definition,
      value: fixture.response.value,
    });
    expect(window.electronAPI!.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.BACKEND.REQUEST,
      fixture.request,
    );
  });

  it('pins settings.reset with the documented path request and applied value', async () => {
    const fixture = SETTINGS_PROTOCOL_FIXTURES.resetMaxConcurrent;
    mockBackend(fixture.request, fixture.response);

    await expect(client.settings.reset('agents.maxConcurrent')).resolves.toEqual(fixture.response);
    expect(window.electronAPI!.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.BACKEND.REQUEST,
      fixture.request,
    );
  });

  it('hydrates all five Agent Backend settings from exact settings.get requests', async () => {
    const maxConcurrent = SETTINGS_PROTOCOL_FIXTURES.maxConcurrent;
    const flushQueuedMessages = SETTINGS_PROTOCOL_FIXTURES.flushQueuedMessages;
    const memoryBudgetMb = SETTINGS_PROTOCOL_FIXTURES.memoryBudgetMb;
    const idleReapMinutes = SETTINGS_PROTOCOL_FIXTURES.idleReapMinutes;
    const acpNodeMaxOldSpaceMb = SETTINGS_PROTOCOL_FIXTURES.acpNodeMaxOldSpaceMb;
    const assertComplete = mockBackendSequence([
      { request: maxConcurrent.request, response: maxConcurrent.response },
      { request: flushQueuedMessages.request, response: flushQueuedMessages.response },
      { request: memoryBudgetMb.request, response: memoryBudgetMb.response },
      { request: idleReapMinutes.request, response: idleReapMinutes.response },
      { request: acpNodeMaxOldSpaceMb.request, response: acpNodeMaxOldSpaceMb.response },
    ]);

    render(AgentBackendSettings);

    const input = (await screen.findByPlaceholderText('Auto')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('12'));
    expect(await screen.findByText('System Messages Only')).toBeTruthy();
    assertComplete();
    for (const [nth, fixture] of [
      [1, maxConcurrent],
      [2, flushQueuedMessages],
      [3, memoryBudgetMb],
      [4, idleReapMinutes],
      [5, acpNodeMaxOldSpaceMb],
    ] as const) {
      expect(window.electronAPI!.invoke).toHaveBeenNthCalledWith(
        nth,
        IPC_CHANNELS.BACKEND.REQUEST,
        fixture.request,
      );
    }
    // The budget's ceiling is whatever bound the catalog carried on the wire.
    const slider = (await screen.findByRole('slider')) as HTMLInputElement;
    expect(slider.max).toBe(String(memoryBudgetMb.response.definition.max));
    // A null value means the key is absent; the field shows the catalog default.
    const heap = (await screen.findByLabelText('ACP Node heap limit (MB)')) as HTMLInputElement;
    expect(heap.value).toBe(String(acpNodeMaxOldSpaceMb.response.definition.defaultValue));
  });

  it.each([
    ['blur', 18],
    ['Enter', 19],
  ])(
    'persists the Agent Backend field on %s through settings.get/update',
    async (activation, value) => {
      const get = SETTINGS_PROTOCOL_FIXTURES.maxConcurrent;
      const getFlush = SETTINGS_PROTOCOL_FIXTURES.flushQueuedMessages;
      const getBudget = SETTINGS_PROTOCOL_FIXTURES.memoryBudgetMb;
      const getIdleReap = SETTINGS_PROTOCOL_FIXTURES.idleReapMinutes;
      const getAcpHeap = SETTINGS_PROTOCOL_FIXTURES.acpNodeMaxOldSpaceMb;
      const update = {
        request: {
          method: 'settings.update',
          params: { changes: [{ path: 'agents.maxConcurrent', value }] },
        },
        response: { applied: [{ path: 'agents.maxConcurrent', value }] },
      };
      const assertComplete = mockBackendSequence([
        { request: get.request, response: get.response },
        { request: getFlush.request, response: getFlush.response },
        { request: getBudget.request, response: getBudget.response },
        { request: getIdleReap.request, response: getIdleReap.response },
        { request: getAcpHeap.request, response: getAcpHeap.response },
        update,
      ]);

      render(AgentBackendSettings);
      const input = (await screen.findByPlaceholderText('Auto')) as HTMLInputElement;
      await waitFor(() => expect(input.value).toBe('12'));
      await fireEvent.input(input, { target: { value: String(value) } });
      await waitFor(() => expect(input.value).toBe(String(value)));
      if (activation === 'blur') await fireEvent.blur(input);
      else await fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(assertComplete);
      expect(window.electronAPI!.invoke).toHaveBeenNthCalledWith(
        1,
        IPC_CHANNELS.BACKEND.REQUEST,
        get.request,
      );
      expect(window.electronAPI!.invoke).toHaveBeenNthCalledWith(
        2,
        IPC_CHANNELS.BACKEND.REQUEST,
        getFlush.request,
      );
      expect(window.electronAPI!.invoke).toHaveBeenNthCalledWith(
        6,
        IPC_CHANNELS.BACKEND.REQUEST,
        update.request,
      );
    },
  );

  it('persists the explicit WebSocket port Save through documented settings methods', async () => {
    const list = SHIPPED_WEBSOCKET_SETTING_FIXTURES.list;
    const update = {
      request: {
        method: 'settings.update',
        params: { changes: [{ path: 'server.wsApi.port', value: 6123 }] },
      },
      response: { applied: [{ path: 'server.wsApi.port', value: 6123 }] },
    };
    const assertComplete = mockBackendSequence([
      { request: list.request, response: list.response },
      update,
    ]);

    render(WebSocketApiSettings);
    const input = (await screen.findByRole('spinbutton', {
      name: 'WebSocket API port',
    })) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('5181'));
    await fireEvent.input(input, { target: { value: '6123' } });
    await waitFor(() => expect(input.value).toBe('6123'));
    await fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(assertComplete);
    expect(window.electronAPI!.invoke).toHaveBeenNthCalledWith(
      1,
      IPC_CHANNELS.BACKEND.REQUEST,
      list.request,
    );
    expect(window.electronAPI!.invoke).toHaveBeenNthCalledWith(
      2,
      IPC_CHANNELS.BACKEND.REQUEST,
      update.request,
    );
  });

  it('characterizes the shipped pairing seam without claiming PROTOCOL coverage', async () => {
    const fixture = UNDOCUMENTED_SERVER_FIXTURES.pairingInfo;
    mockBackend(fixture.request, fixture.response);

    await expect(client.server.pairingInfo()).resolves.toEqual(fixture.response);
    expect(window.electronAPI!.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.BACKEND.REQUEST,
      fixture.request,
    );
  });

  it('keeps Fonts & Colors and General preferences FE-owned with no daemon write', async () => {
    await expect(client.settings.getUserPreferences()).resolves.toBeNull();
    await expect(
      client.settings.setUserPreferences({ noteFontStyle: 'monospace' }),
    ).resolves.toEqual({
      success: true,
    });
    expect(window.electronAPI!.invoke).not.toHaveBeenCalled();
  });
});
