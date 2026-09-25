/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { LiveAppClient } from '$lib/client';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { m } from '$shared/paraglide/messages.js';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import { settingsFormSaga } from '$store/renderer/slices/settings-events/sagas/settings-form-saga';
import { selectSettingsFormOperation } from '$store/renderer/slices/settings-events/settings-events-selectors';
import { websocketApiSaga } from '$store/renderer/slices/websocket-api/sagas/websocket-api-saga';
import { connectionsSaga } from '$store/renderer/slices/connections/sagas/connections-saga';
import {
  SETTINGS_PROTOCOL_FIXTURES,
  SHIPPED_WEBSOCKET_SETTING_FIXTURES,
  UNDOCUMENTED_SERVER_FIXTURES,
} from './settings-page.fixtures';

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import AgentBackendSettings from '$lib/components/settings/AgentBackendSettings.svelte';
import WebSocketApiSettings from '$lib/components/settings/WebSocketApiSettings.svelte';

type BackendStep = { request: unknown; response: unknown };

describe('Settings deterministic mock-BE contracts', () => {
  const originalInvoke = window.electronAPI!.invoke;
  const client = new LiveAppClient();
  let storeContext: ReduxStoreContext | undefined;
  let stopOwners: Array<() => void>;

  beforeEach(async () => {
    __resetSettingsReadCacheForTests();
    storeContext = initAppStore(appStore);
    resetMockIpcRouter();
    window.electronAPI!.invoke = vi.fn((channel: string, payload?: unknown) =>
      mockInvoke(channel, payload),
    );
    registerMockIpcHandler(IPC_CHANNELS.CONNECTIONS.LIST, () => ({
      connections: [],
      activeId: 'local',
      windowBackendId: 'local',
    }));
    registerMockIpcHandler(IPC_CHANNELS.CONNECTIONS.SYNC_GET_STATE, () => ({
      supported: false,
      enabled: false,
      status: null,
    }));
    registerMockIpcHandler(IPC_CHANNELS.CONNECTIONS.SELF_PUBLISHED_STATE, () => ({
      published: false,
      suppressed: false,
      selfConnectionId: null,
    }));
    registerMockIpcHandler(IPC_CHANNELS.CONNECTIONS.REFRESH_SELF, () => ({ refreshed: false }));
    // Run the production panel owners without the unrelated boot settings.list.
    stopOwners = [
      appStore.runSaga(settingsFormSaga),
      appStore.runSaga(websocketApiSaga),
      appStore.runSaga(connectionsSaga),
    ];
    await waitFor(() => expect(appStore.state.connections.hasReceivedList).toBe(true));
    vi.mocked(window.electronAPI!.invoke).mockClear();
  });

  afterEach(() => {
    cleanup();
    stopOwners.forEach((stop) => stop());
    storeContext?.dispose();
    storeContext = undefined;
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
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_devices_advanced_label() }),
    );
    const input = (await screen.findByRole('spinbutton', {
      name: m.settings_wsApi_port_label(),
    })) as HTMLInputElement;
    await waitFor(() => {
      expect(input.disabled).toBe(false);
      expect(input.value).toBe('5181');
    });
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
    await waitFor(() => {
      expect(input.disabled).toBe(false);
      expect(input.value).toBe('6123');
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });
  });

  it('persists multiselect networks through settings.update and renders the refreshed daemon selection', async () => {
    let bound = ['192.0.2.10', '127.0.0.1'];
    const expectedChanges = [
      { path: 'server.bindAddress', value: ['192.0.2.10', '127.0.0.1', '198.51.100.7'] },
    ];
    registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (payload) => {
      const request = payload as { method: string; params?: unknown };
      if (request.method === 'settings.list') {
        expect(request).toEqual({ method: 'settings.list', params: undefined });
        return {
          ok: true,
          result: {
            settings: [
              ...SHIPPED_WEBSOCKET_SETTING_FIXTURES.list.response.settings.map((row) => ({
                ...row,
                value: row.path === 'server.wsApi.enabled' ? true : row.value,
              })),
              {
                path: 'server.bindAddress',
                label: 'Bind addresses',
                description: '',
                category: 'server',
                type: 'string[]',
                defaultValue: ['127.0.0.1'],
                value: bound,
              },
            ],
          },
        };
      }
      if (request.method === 'server.pairingInfo') {
        expect(request).toEqual(UNDOCUMENTED_SERVER_FIXTURES.pairingInfo.request);
        return { ok: true, result: UNDOCUMENTED_SERVER_FIXTURES.pairingInfo.response };
      }
      expect(request).toEqual({ method: 'settings.update', params: { changes: expectedChanges } });
      bound = ['192.0.2.10', '127.0.0.1', '198.51.100.7'];
      return { ok: true, result: { applied: expectedChanges } };
    });
    render(WebSocketApiSettings);
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_devices_advanced_label() }),
    );
    const input = await screen.findByRole('combobox', { name: m.settings_listenTargets_label() });
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    const identity = getItems(appStore.state.settingsEvents.forms)[0];
    input.focus();
    await fireEvent.pointerUp(await screen.findByRole('option', { name: '198.51.100.7' }), {
      button: 0,
      pointerType: 'mouse',
    });
    await waitFor(() =>
      expect(window.electronAPI!.invoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, {
        method: 'settings.update',
        params: { changes: expectedChanges },
      }),
    );
    await waitFor(() => {
      expect(selectSettingsFormOperation.select(appStore.state, identity, 'save')?.status).toBe(
        'succeeded',
      );
      expect((input as HTMLInputElement).disabled).toBe(false);
    });
    // Saving disables the combobox; reopen after its terminal state is published.
    await fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox', { hidden: true })).toBeNull());
    await waitFor(() =>
      expect((input as HTMLInputElement).value).toBe(
        '192.0.2.10, 127.0.0.1 (localhost), 198.51.100.7',
      ),
    );
    input.focus();
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: '198.51.100.7' }).getAttribute('aria-selected'),
      ).toBe('true'),
    );
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe(
      '192.0.2.10, 127.0.0.1 (localhost), 198.51.100.7',
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
