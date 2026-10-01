import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Shell from './DevConsoleShell.svelte';
import { resetMonaco, editors, models, initializePayloadMonaco } from './__tests__/monaco-mock';
vi.mock('./payload-monaco', () => ({ initializePayloadMonaco: () => initializePayloadMonaco() }));

import { DevConsoleCaptureService } from './main/dev-console-capture';
import type { RpcTrafficObserver } from '$features/backend/main/rpc-traffic';
import type { DevConsoleRecord } from '$shared/types/dev-console';
const original = window.electronAPI;
beforeEach(() => {
  resetMonaco();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  window.electronAPI = original;
  vi.unstubAllGlobals();
});
function setup(maxRecords = 100) {
  const capture = new DevConsoleCaptureService({ maxRecords });
  let emit!: RpcTrafficObserver;
  capture.registerClient('one', 'main', {
    observeTraffic(fn) {
      emit = fn;
      return () => {};
    },
  });
  const { sessionId } = capture.openSession('one');
  let changed: ((event: { sessionId: string }) => void) | undefined;
  capture.subscribe('one', sessionId, () => changed?.({ sessionId }));
  const invoke = vi.fn(async (channel: string, data: any) => {
    if (channel === 'dev-console:connect') return { backendId: 'one', sessionId };
    if (channel === 'dev-console:read')
      return capture.getUpdate('one', sessionId, data.afterRevision);
    if (channel === 'dev-console:record') return capture.getRecord('one', sessionId, data.recordId);
    if (channel === 'dev-console:select')
      return capture.setFullCapture('one', sessionId, data.selection, data.enabled);
    if (channel === 'dev-console:clear') return capture.clearSession('one', sessionId);
    throw new Error(channel);
  });
  window.electronAPI = {
    invoke,
    on: (channel: string, cb: any) => {
      if (channel === 'dev-console:changed') changed = cb;
      return channel;
    },
    offById: vi.fn(),
  } as any;
  const view = render(Shell);
  const request = (key: string, method: string, payload: unknown = { key }) =>
    emit({
      type: 'request',
      direction: 'outbound',
      key,
      requestId: key,
      method,
      payload,
      connectionGeneration: 1,
    });
  return { capture, emit, invoke, view, request, sessionId };
}
it('loads only selected payloads, refreshes their response, and sends exact prospective capture choices', async () => {
  const { request, emit, invoke, view, sessionId, capture } = setup();
  request('a', 'agent.send', { text: 'x'.repeat(5000) });
  request('b', 'other');
  await waitFor(() => expect(view.getByText('agent.send')).toBeTruthy());
  expect(invoke.mock.calls.filter(([channel]) => channel === 'dev-console:record')).toHaveLength(0);
  await fireEvent.click(view.getByText('agent.send'));
  await waitFor(() =>
    expect(
      view.container.querySelector('[data-testid=payload-document]')?.textContent?.length,
    ).toBe(2048),
  );
  await fireEvent.click(view.getByRole('checkbox'));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('dev-console:select', {
      sessionId,
      selection: { direction: 'outbound', kind: 'request', method: 'agent.send' },
      enabled: true,
    }),
  );
  expect(view.container.querySelector('[data-testid=payload-document]')?.textContent?.length).toBe(
    2048,
  );
  emit({
    type: 'response',
    key: 'a',
    status: 'success',
    payload: { text: 'y'.repeat(5000) },
    connectionGeneration: 1,
  });
  await waitFor(() =>
    expect(
      view.container.querySelectorAll('[data-testid=payload-document]')[1]?.textContent,
    ).toContain('y'.repeat(5000)),
  );
  const reads = invoke.mock.calls.filter(([c]) => c === 'dev-console:record').length;
  request('c', 'unrelated');
  await waitFor(() => expect(view.getByText('unrelated')).toBeTruthy());
  expect(invoke.mock.calls.filter(([c]) => c === 'dev-console:record')).toHaveLength(reads);
  await fireEvent.click(view.getByRole('button', { name: 'Clear', exact: true }));
  await waitFor(() =>
    expect(view.container.querySelectorAll('[data-testid=payload-document]')).toHaveLength(0),
  );
  expect(capture.getSnapshot('one', sessionId)?.records).toEqual([]);
  expect(editors.every((editor) => editor.dispose.mock.calls.length === 1)).toBe(true);
  expect(models.every((model) => model.dispose.mock.calls.length === 1)).toBe(true);
});
it('discards a selected payload when its row is evicted, filtered out or deselected', async () => {
  const { request, view } = setup(2);
  request('a', 'first');
  request('b', 'second');
  await waitFor(() => expect(view.getByText('first')).toBeTruthy());
  await fireEvent.click(view.getByText('first'));
  await waitFor(() =>
    expect(view.container.querySelector('[data-testid=payload-document]')).toBeTruthy(),
  );
  request('c', 'third');
  await waitFor(() =>
    expect(view.container.querySelector('[data-testid=payload-document]')).toBeNull(),
  );
  await fireEvent.click(view.getByText('second'));
  await waitFor(() =>
    expect(view.container.querySelector('[data-testid=payload-document]')).toBeTruthy(),
  );
  await fireEvent.input(view.getByRole('textbox'), { target: { value: 'third' } });
  await waitFor(() =>
    expect(view.container.querySelector('[data-testid=payload-document]')).toBeNull(),
  );
});
it('rejects a late payload from a formerly selected row', async () => {
  const { request, view, invoke } = setup();
  request('a', 'first');
  request('b', 'second');
  await waitFor(() => expect(view.getByText('first')).toBeTruthy());
  const originalImpl = invoke.getMockImplementation()!;
  let resolve!: (record: DevConsoleRecord | null) => void;
  invoke.mockImplementation(async (channel, data) =>
    channel === 'dev-console:record'
      ? new Promise<DevConsoleRecord | null>((done) => {
          resolve = done;
        })
      : originalImpl(channel, data),
  );
  await fireEvent.click(view.getByText('first'));
  await fireEvent.click(view.getByRole('button', { name: 'Close details' }));
  resolve({
    id: 'late',
    payload: {
      text: 'PRIVATE-LATE-REPLY',
      state: 'complete',
      retainedBytes: 18,
      originalBytes: 18,
    },
  } as DevConsoleRecord);
  await Promise.resolve();
  expect(view.container.textContent).not.toContain('PRIVATE-LATE-REPLY');
  expect(view.container.querySelector('[data-testid=payload-document]')).toBeNull();
});

it('keeps a rejected full-capture checkbox off and reports the control error', async () => {
  const { request, view, invoke } = setup();
  request('a', 'first');
  await waitFor(() => expect(view.getByText('first')).toBeTruthy());
  await fireEvent.click(view.getByText('first'));
  const originalImpl = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (channel, data) =>
    channel === 'dev-console:select' ? false : originalImpl(channel, data),
  );
  await fireEvent.click(view.getByRole('checkbox'));
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
  expect(view.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
});

it('shows bridge connection failures without inventing an active session', async () => {
  window.electronAPI = {
    invoke: vi.fn().mockRejectedValue(new Error('native session unavailable')),
    on: () => 'listener',
    offById: vi.fn(),
  } as any;
  const view = render(Shell);
  await waitFor(() =>
    expect(view.getByRole('alert').textContent).toContain('native session unavailable'),
  );
  expect(view.container.querySelector('[data-dev-console-ready="true"]')).toBeNull();
  expect(view.container.querySelector('[data-testid=payload-document]')).toBeNull();
});

it('separates three tabs, keeps method filtering/counts scoped, and resets details on tab changes', async () => {
  const { request, emit, view } = setup();
  request('a', 'same.method');
  emit({
    type: 'request',
    direction: 'inbound',
    key: 'reverse',
    requestId: 22,
    method: 'same.method',
    payload: { reverseOnly: true },
    connectionGeneration: 1,
  });
  emit({
    type: 'notification',
    method: 'events.event',
    payload: { event: { type: 'same.event', eventOnly: true } },
    connectionGeneration: 1,
  });
  emit({
    type: 'notification',
    method: 'events.event',
    payload: { event: { type: 'other.event' } },
    connectionGeneration: 1,
  });
  await waitFor(() => expect(view.getByRole('cell', { name: 'same.method' })).toBeTruthy());
  expect(view.getAllByRole('tab')).toHaveLength(3);
  await fireEvent.click(view.getByRole('cell', { name: 'same.method' }));
  await waitFor(() =>
    expect(view.container.querySelector('[data-testid=payload-document]')?.textContent).toContain(
      '"key": "a"',
    ),
  );
  await fireEvent.click(view.getByRole('tab', { name: 'Inbound RPC', exact: true }));
  expect(view.container.querySelector('[data-testid=payload-document]')).toBeNull();
  await fireEvent.click(view.getByRole('cell', { name: 'same.method' }));
  await waitFor(() =>
    expect(view.container.querySelector('[data-testid=payload-document]')?.textContent).toContain(
      'reverseOnly',
    ),
  );
  await fireEvent.click(view.getByRole('tab', { name: 'Events', exact: true }));
  expect(view.container.querySelector('[data-testid=payload-document]')).toBeNull();
  await waitFor(() =>
    expect(view.container.querySelector('footer')?.textContent).toContain('2 shown'),
  );
  expect(view.queryByRole('cell', { name: 'same.method' })).toBeNull();
  await fireEvent.input(view.getByRole('textbox'), { target: { value: 'same' } });
  await waitFor(() =>
    expect(view.container.querySelector('footer')?.textContent).toContain('1 shown'),
  );
  await fireEvent.click(view.getByRole('cell', { name: 'same.event' }));
  await waitFor(() =>
    expect(view.container.querySelector('[data-testid=payload-document]')?.textContent).toContain(
      'eventOnly',
    ),
  );
  await fireEvent.click(view.getByRole('tab', { name: 'Outbound RPC', exact: true }));
  expect(view.container.querySelector('[data-testid=payload-document]')).toBeNull();
  expect(view.getByRole('cell', { name: 'same.method' })).toBeTruthy();
});
