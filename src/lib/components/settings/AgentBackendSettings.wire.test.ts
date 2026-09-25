/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '$store/renderer/store';
import { settingsHydrationSaga } from '$store/renderer/slices/settings-events/sagas/settings-hydration-saga';
import {
  selectSettingsForm,
  selectSettingsFormEntry,
  selectSettingsFormOperation,
} from '$store/renderer/slices/settings-events/settings-events-selectors';
import type { SettingDefinitionWithValue } from '$lib/client/app-client';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';
import AgentBackendSettings from './AgentBackendSettings.svelte';

const mocks = vi.hoisted(() => ({ request: vi.fn(), update: vi.fn() }));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return { appClient: { settings: new LiveSettingsClient() } };
});
vi.mock('svelte-fa', async () => ({
  default: (await import('../ui/__tests__/mocks/Fa.svelte')).default,
}));

const BUDGET = 'agents.memoryBudgetMb';
const IDLE = 'agents.idleReapMinutes';
const HEAP = 'agents.acpNodeMaxOldSpaceMb';
const FLUSH = 'agents.flushQueuedMessages';
const CAP = 'agents.maxConcurrent';
const catalog: SettingDefinitionWithValue[] = [
  {
    path: CAP,
    label: 'Concurrent agents',
    description: 'Concurrent session limit',
    category: 'agents',
    type: 'number',
    value: 12,
    min: 0,
    max: 200,
    defaultValue: 0,
  },
  {
    path: FLUSH,
    label: 'Flush mode',
    description: 'Queued message delivery',
    category: 'agents',
    type: 'enum',
    enumValues: ['all', 'systemOnly', 'off'],
    value: 'all',
    defaultValue: 'all',
  },
  {
    path: BUDGET,
    label: 'Memory budget',
    description: 'Aggregate child memory limit',
    category: 'agents',
    type: 'number',
    value: 100,
    min: 0,
    max: 49152,
    defaultValue: 24576,
  },
  {
    path: IDLE,
    label: 'Idle reap',
    description: 'Idle session reap interval',
    category: 'agents',
    type: 'number',
    value: 30,
    min: 0,
    defaultValue: 10,
  },
  {
    path: HEAP,
    label: 'ACP heap',
    description: 'Per-process Node heap cap',
    category: 'agents',
    type: 'number',
    value: null,
    min: 1024,
    max: 65536,
    defaultValue: 8192,
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let stop: () => void;
let dispose: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  __resetSettingsReadCacheForTests();
  mocks.update.mockImplementation(async (params) => ({ applied: params.changes, revision: 2 }));
  mocks.request.mockImplementation(async (method, params) => {
    // Keep the independent boot snapshot pending; the production composed form
    // owner must still handle mounted panels and its own settings.get reads.
    if (method === 'settings.list') return new Promise(() => {});
    if (method === 'settings.get') {
      const entry = catalog.find(({ path }) => path === params.path);
      if (!entry) throw new Error('Unknown setting');
      const { value, ...definition } = entry;
      return { path: entry.path, definition, value, origin: 'file', revision: 1 };
    }
    if (method === 'settings.update') return mocks.update(params);
    throw new Error(`Unexpected method: ${method}`);
  });
  dispose = store.init();
  stop = store.runSaga(settingsHydrationSaga);
});
afterEach(() => {
  cleanup();
  stop();
  dispose();
  __resetSettingsReadCacheForTests();
});

async function mounted() {
  const component = render(AgentBackendSettings);
  await waitFor(() => expect(screen.getByLabelText('Agent memory budget')).toBeTruthy());
  const identity = getItems(store.state.settingsEvents.forms)[0];
  expect(selectSettingsForm.select(store.state, identity)?.loaded).toBe(true);
  return { component, identity };
}

async function enter(label: string, value: string) {
  const input = screen.getByLabelText(label);
  await fireEvent.input(input, { target: { value } });
  await fireEvent.blur(input);
  return input as HTMLInputElement;
}

describe('AgentBackendSettings through configured Store and hydration owner', () => {
  it('reads all catalog definitions with exact settings.get params while boot hydration is pending', async () => {
    const { identity } = await mounted();
    expect(mocks.request).toHaveBeenCalledWith('settings.list');
    expect(mocks.request.mock.calls.filter(([method]) => method === 'settings.get')).toEqual([
      ['settings.get', { path: CAP }],
      ['settings.get', { path: FLUSH }],
      ['settings.get', { path: BUDGET }],
      ['settings.get', { path: IDLE }],
      ['settings.get', { path: HEAP }],
    ]);
    expect(selectSettingsFormEntry.select(store.state, identity, HEAP)).toMatchObject({
      value: null,
      defaultValue: 8192,
    });
    expect((screen.getByLabelText('ACP Node heap limit (MB)') as HTMLInputElement).value).toBe(
      '8192',
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    [BUDGET, 'Agent memory budget', '2048', 2048],
    [IDLE, 'Idle reap minutes', '45', 45],
    [HEAP, 'ACP Node heap limit (MB)', '16384', 16384],
    [CAP, 'Max concurrent agents', '24', 24],
  ])(
    'writes %s with the exact transport payload and renders its acknowledgement',
    async (path, label, text, value) => {
      const { identity } = await mounted();
      const input = await enter(String(label), String(text));
      await waitFor(() =>
        expect(
          selectSettingsFormOperation.select(store.state, identity, String(path))?.status,
        ).toBe('succeeded'),
      );
      expect(mocks.request).toHaveBeenCalledWith('settings.update', { changes: [{ path, value }] });
      expect(selectSettingsFormEntry.select(store.state, identity, String(path))?.value).toBe(
        value,
      );
      await waitFor(() => expect(input.value).toBe(String(value)));
    },
  );

  it('serializes and coalesces a rapid budget burst, preserving newer uncommitted text', async () => {
    const first = deferred<{ applied: { path: string; value: number }[]; revision: number }>();
    mocks.update.mockImplementationOnce(() => first.promise);
    const { identity } = await mounted();
    const input = await enter('Agent memory budget', '200');
    await enter('Agent memory budget', '300');
    await enter('Agent memory budget', '400');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await fireEvent.input(input, { target: { value: '500' } });
    first.resolve({ applied: [{ path: BUDGET, value: 200 }], revision: 2 });
    await waitFor(() =>
      expect(selectSettingsFormOperation.select(store.state, identity, BUDGET)?.status).toBe(
        'succeeded',
      ),
    );
    expect(mocks.update.mock.calls).toEqual([
      [{ changes: [{ path: BUDGET, value: 200 }] }],
      [{ changes: [{ path: BUDGET, value: 400 }] }],
    ]);
    await waitFor(() => expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('400'));
    expect(input.value).toBe('500');
  });

  it.each([
    [BUDGET, 'Agent memory budget', '200', '100'],
    [IDLE, 'Idle reap minutes', '60', '30'],
    [HEAP, 'ACP Node heap limit (MB)', '16384', '8192'],
  ])(
    'rolls a rejected %s back and allows the same value to be retried',
    async (path, label, next, previous) => {
      mocks.update.mockResolvedValueOnce({ applied: [], revision: 2 });
      const { identity } = await mounted();
      const input = await enter(label, next);
      await waitFor(() =>
        expect(selectSettingsFormOperation.select(store.state, identity, path)?.status).toBe(
          'failed',
        ),
      );
      await waitFor(() => expect(input.value).toBe(previous));
      expect(screen.getByRole('alert')).toBeTruthy();
      await enter(label, next);
      await waitFor(() =>
        expect(selectSettingsFormOperation.select(store.state, identity, path)?.status).toBe(
          'succeeded',
        ),
      );
      expect(mocks.update).toHaveBeenCalledTimes(2);
      expect(mocks.request).toHaveBeenLastCalledWith('settings.update', {
        changes: [{ path, value: Number(next) }],
      });
      await waitFor(() => expect(input.value).toBe(next));
    },
  );

  it('allows a heap write while a budget write is pending without losing either acknowledgement', async () => {
    const pending = deferred<{ applied: { path: string; value: number }[]; revision: number }>();
    mocks.update.mockImplementationOnce(() => pending.promise);
    const { identity } = await mounted();
    const budget = await enter('Agent memory budget', '200');
    const heap = await enter('ACP Node heap limit (MB)', '16384');
    await waitFor(() =>
      expect(selectSettingsFormOperation.select(store.state, identity, HEAP)?.status).toBe(
        'succeeded',
      ),
    );
    expect(selectSettingsFormOperation.select(store.state, identity, BUDGET)?.status).toBe(
      'pending',
    );
    expect(mocks.update.mock.calls).toEqual([
      [{ changes: [{ path: BUDGET, value: 200 }] }],
      [{ changes: [{ path: HEAP, value: 16384 }] }],
    ]);
    pending.resolve({ applied: [{ path: BUDGET, value: 192 }], revision: 3 });
    await waitFor(() => expect(budget.value).toBe('192'));
    expect(heap.value).toBe('16384');
  });

  it('does not send the same pending numeric target twice when Enter is followed by blur', async () => {
    const pending = deferred<{ applied: { path: string; value: number }[]; revision: number }>();
    mocks.update.mockImplementationOnce(() => pending.promise);
    const { identity } = await mounted();
    const input = screen.getByLabelText('ACP Node heap limit (MB)');
    await fireEvent.input(input, { target: { value: '16384' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.blur(input);
    pending.resolve({ applied: [{ path: HEAP, value: 16384 }], revision: 2 });
    await waitFor(() =>
      expect(selectSettingsFormOperation.select(store.state, identity, HEAP)?.status).toBe(
        'succeeded',
      ),
    );
    expect(mocks.update.mock.calls).toEqual([[{ changes: [{ path: HEAP, value: 16384 }] }]]);
  });

  it('resets both budget editing surfaces after invalid text without sending a write', async () => {
    await mounted();
    const slider = screen.getByRole('slider') as HTMLInputElement;
    await fireEvent.input(slider, { target: { value: '200' } });
    const input = await enter('Agent memory budget', '-1');
    await waitFor(() => expect(input.value).toBe('100'));
    expect(slider.value).toBe('100');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('drops coalesced writes after a rejected acknowledgement and leaves the field retryable', async () => {
    const first = deferred<{ applied: { path: string; value: number }[]; revision: number }>();
    mocks.update.mockImplementationOnce(() => first.promise);
    const { identity } = await mounted();
    const input = await enter('Agent memory budget', '200');
    await enter('Agent memory budget', '300');
    first.resolve({ applied: [], revision: 2 });
    await waitFor(() =>
      expect(selectSettingsFormOperation.select(store.state, identity, BUDGET)?.status).toBe(
        'failed',
      ),
    );
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(input.value).toBe('100'));
    await enter('Agent memory budget', '300');
    await waitFor(() => expect(input.value).toBe('300'));
    expect(mocks.update).toHaveBeenLastCalledWith({ changes: [{ path: BUDGET, value: 300 }] });
  });

  it('writes the flush enum on the wire and displays only the acknowledged mode', async () => {
    mocks.update.mockResolvedValueOnce({ applied: [{ path: FLUSH, value: 'off' }], revision: 2 });
    const { identity } = await mounted();
    const trigger = screen.getByRole('combobox', { name: 'Flush queued messages' });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await waitFor(() =>
      expect(selectSettingsFormOperation.select(store.state, identity, FLUSH)?.status).toBe(
        'succeeded',
      ),
    );
    expect(mocks.request).toHaveBeenLastCalledWith('settings.update', {
      changes: [{ path: FLUSH, value: 'systemOnly' }],
    });
    await waitFor(() => expect(trigger.textContent).toContain('Off (FIFO)'));
  });

  it('restores the last acknowledged idle interval instead of the newer catalog default', async () => {
    await mounted();
    const toggle = screen.getByRole('switch', { name: 'Reap idle agents' });
    await fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByLabelText('Idle reap minutes')).toBeNull());
    await fireEvent.click(toggle);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls).toEqual([
      [{ changes: [{ path: IDLE, value: 0 }] }],
      [{ changes: [{ path: IDLE, value: 30 }] }],
    ]);
  });

  it('drops unsent work on close and ignores a late acknowledgement', async () => {
    const pending = deferred<{ applied: { path: string; value: number }[]; revision: number }>();
    mocks.update.mockImplementationOnce(() => pending.promise);
    const { component, identity } = await mounted();
    await enter('Agent memory budget', '200');
    await enter('Agent memory budget', '300');
    component.unmount();
    pending.resolve({ applied: [{ path: BUDGET, value: 200 }], revision: 2 });
    await Promise.resolve();
    await Promise.resolve();
    expect(selectSettingsForm.select(store.state, identity)).toBeUndefined();
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
