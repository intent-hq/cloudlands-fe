import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';

// The payload assertions deliberately pin literal wall-clock text. Keep the real
// local formatter and scope its timezone to this suite, including module imports.
vi.hoisted(() => vi.stubEnv('TZ', 'UTC'));
afterAll(() => vi.unstubAllEnvs());
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
  vi.restoreAllMocks();
});
function setup(
  maxRecords = 100,
  options: ConstructorParameters<typeof DevConsoleCaptureService>[0] = {},
) {
  const capture = new DevConsoleCaptureService({ maxRecords, ...options });
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

it('moves keyboard focus into compact details and back to the selected record on close', async () => {
  const { request, view } = setup();
  request('a', 'first');
  request('b', 'second');
  await waitFor(() => expect(view.getByText('second')).toBeTruthy());
  const row = view.getByText('second').closest<HTMLElement>('[role=row]')!;
  row.focus();
  await fireEvent.keyDown(row, { key: 'Enter' });
  const close = view.getByRole('button', { name: 'Close details' });
  await waitFor(() => expect(document.activeElement).toBe(close));
  await fireEvent.click(close);
  await waitFor(() => expect(document.activeElement).toBe(row));
  expect(view.queryByRole('button', { name: 'Close details' })).toBeNull();
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

it('combines all streams by default, separates dedicated tabs, keeps method filtering/counts scoped, and resets details on tab changes', async () => {
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
  await waitFor(() => expect(view.getAllByRole('cell', { name: 'same.method' })).toHaveLength(2));
  expect(view.getByRole('tab', { name: 'All', exact: true }).getAttribute('aria-selected')).toBe(
    'true',
  );
  expect(view.container.querySelector('footer')?.textContent).toContain('4 shown');
  await fireEvent.input(view.getByRole('textbox'), { target: { value: 'same' } });
  await waitFor(() =>
    expect(view.container.querySelector('footer')?.textContent).toContain('3 shown'),
  );
  expect(view.queryByRole('cell', { name: 'other.event' })).toBeNull();
  await fireEvent.input(view.getByRole('textbox'), { target: { value: '' } });
  await fireEvent.click(view.getByRole('tab', { name: 'Outbound RPC', exact: true }));
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

it('keeps a selected request in its chronological position when a reply arrives among equal-time streams', async () => {
  const { emit, request, view } = setup();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    request('out', 'first.call');
    emit({
      type: 'notification',
      method: 'events.event',
      payload: { event: { type: 'second.event' } },
      connectionGeneration: 1,
    });
    emit({
      type: 'request',
      direction: 'inbound',
      key: 'in',
      requestId: 2,
      method: 'third.call',
      payload: {},
      connectionGeneration: 1,
    });
    clock.mockRestore();
    const methods = () =>
      Array.from(
        view.container.querySelectorAll('[data-index] .method'),
        (cell) => cell.textContent,
      );
    await waitFor(() => expect(methods()).toEqual(['first.call', 'second.event', 'third.call']));
    await fireEvent.click(view.getByRole('cell', { name: 'first.call' }));
    await waitFor(() =>
      expect(view.container.querySelector('[data-testid=payload-document]')?.textContent).toContain(
        'out',
      ),
    );
    emit({
      type: 'response',
      key: 'out',
      status: 'success',
      payload: { done: true },
      connectionGeneration: 1,
    });
    await waitFor(() =>
      expect(
        view.container.querySelectorAll('[data-testid=payload-document]')[1]?.textContent,
      ).toContain('"done": true'),
    );
    expect(methods()).toEqual(['first.call', 'second.event', 'third.call']);
    expect(
      view.container.querySelector('[aria-selected="true"][data-index] .method')?.textContent,
    ).toBe('first.call');
    await fireEvent.click(view.getByRole('button', { name: 'Close details' }));
    await fireEvent.click(view.getByRole('cell', { name: 'second.event' }));
    await waitFor(() =>
      expect(view.container.querySelector('[data-testid=payload-document]')?.textContent).toContain(
        'second.event',
      ),
    );
    await fireEvent.click(view.getByRole('button', { name: 'Clear', exact: true }));
    await waitFor(() => expect(methods()).toEqual([]));
    expect(view.container.querySelector('[data-testid=payload-document]')).toBeNull();
  } finally {
    clock.mockRestore();
  }
});

const documentFor = (view: ReturnType<typeof render>, side: string) =>
  view
    .getByRole('region', { name: side, exact: true })
    .querySelector('[data-testid=payload-document]')?.textContent ?? '';
const byteSize = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

it.each(['chat.subscribe', 'note.subscribe'])(
  'appends %s pushes, preserves the ack, and refreshes selected totals without reselection',
  async (method) => {
    let clock = 0;
    const wall = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 2, 10));
    const { request, emit, view } = setup(100, { monotonicNow: () => clock });
    const params = method === 'chat.subscribe' ? { agentId: 'a' } : { workspaceId: 'w' };
    request('s', method, params);
    clock = 5;
    wall.mockReturnValue(Date.UTC(2026, 9, 2, 10, 0, 0, 5));
    const ack = { subscriptionId: 'sub' };
    emit({ type: 'response', key: 's', status: 'success', payload: ack, connectionGeneration: 1 });
    await waitFor(() => expect(view.getByRole('cell', { name: method })).toBeTruthy());
    const row = view.getByRole('cell', { name: method }).closest('[role=row]')!;
    await fireEvent.click(row);
    await waitFor(() => expect(documentFor(view, 'Response / error')).toContain('sub'));
    const snapshot = {
      subscriptionId: 'sub',
      kind: 'snapshot',
      seq: 0,
      snapshot:
        method === 'chat.subscribe'
          ? { agentId: 'a', messages: [], truncated: false, totalMessages: 0, nextToken: null }
          : [],
    };
    clock = 17;
    wall.mockReturnValue(Date.UTC(2026, 9, 2, 10, 0, 0, 17));
    emit({
      type: 'notification',
      method: 'subscription.push',
      payload: snapshot,
      connectionGeneration: 1,
    });
    const delta = {
      subscriptionId: 'sub',
      kind: 'delta',
      seq: 1,
      delta:
        method === 'chat.subscribe'
          ? {
              updated: [
                {
                  agentId: 'a',
                  messageId: 'm',
                  role: 'assistant',
                  block: { type: 'text', id: 'm:0', text: '🙂' },
                },
              ],
            }
          : { removedIds: ['note-gone'] },
    };
    clock = 40;
    wall.mockReturnValue(Date.UTC(2026, 9, 2, 10, 0, 0, 40));
    emit({
      type: 'notification',
      method: 'subscription.push',
      payload: delta,
      connectionGeneration: 1,
    });
    await waitFor(() =>
      expect(documentFor(view, 'Response / error')).toContain(
        method === 'chat.subscribe' ? '🙂' : 'note-gone',
      ),
    );
    const text = documentFor(view, 'Response / error');
    expect(text.indexOf('"subscriptionId": "sub"')).toBeLessThan(text.indexOf('"snapshot"'));
    expect(text.indexOf('"snapshot"')).toBeLessThan(text.indexOf('"delta"'));
    expect(text).toContain('10:00:00.005');
    expect(text).toContain('10:00:00.017');
    expect(text).toContain('10:00:00.040');
    expect(text).toContain('5 ms since request');
    expect(text).toContain('12 ms since previous');
    expect(text).toContain('23 ms since previous');
    expect(text).toContain(`${byteSize(delta)} / ${byteSize(delta)} bytes`);
    expect(row.textContent).toContain(
      String([params, ack, snapshot, delta].reduce((sum, p) => sum + byteSize(p), 0)),
    );
    expect(row.textContent).toContain('40.0');
    expect(editors).toHaveLength(2);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await fireEvent.click(view.getAllByRole('button', { name: 'Copy payload' })[1]);
    expect(writeText).toHaveBeenCalledWith(
      [ack, snapshot, delta].map((p) => JSON.stringify(p)).join('\n\n'),
    );
  },
);

// The inbound variant exercises the observer seam: production reverse RPCs are one-shot.
it.each(['outbound', 'inbound'] as const)(
  'keeps %s command input and output in separate live panes with independent intervals',
  async (direction) => {
    let clock = 0;
    const { emit, view } = setup(100, { monotonicNow: () => clock });
    emit({
      type: 'request',
      direction,
      key: 'run',
      requestId: 'run',
      method: 'host.execStream',
      payload: { command: 'cat', requestId: 'exec' },
      connectionGeneration: 1,
    });
    clock = 2;
    emit({
      type: 'response',
      key: 'run',
      status: 'success',
      payload: { requestId: 'exec' },
      connectionGeneration: 1,
    });
    await waitFor(() => expect(view.getByRole('cell', { name: 'host.execStream' })).toBeTruthy());
    await fireEvent.click(view.getByRole('cell', { name: 'host.execStream' }));
    clock = 10;
    emit({
      type: 'request',
      direction,
      key: 'write',
      requestId: 'write',
      method: 'host.execStream.write',
      payload: { requestId: 'exec', stdin: 'input-only' },
      connectionGeneration: 1,
    });
    clock = 12;
    emit({
      type: 'response',
      key: 'write',
      status: 'success',
      payload: { ok: true },
      connectionGeneration: 1,
    });
    clock = 31;
    emit({
      type: 'notification',
      direction: direction === 'outbound' ? 'inbound' : 'outbound',
      method: 'events.event',
      payload: {
        subscriptionId: 'events',
        event: {
          type: 'host:exec:stdout',
          id: 'e',
          workspaceId: 'w',
          timestamp: '2026-10-02T10:00:00Z',
          actor: { type: 'system' },
          data: { requestId: 'exec', chunk: 'b3V0cHV0LW9ubHk=' },
        },
      },
      connectionGeneration: 1,
    });
    await waitFor(() =>
      expect(documentFor(view, 'Response / error')).toContain('b3V0cHV0LW9ubHk='),
    );
    expect(documentFor(view, 'Request')).toContain('input-only');
    expect(documentFor(view, 'Request')).not.toContain('b3V0cHV0LW9ubHk=');
    expect(documentFor(view, 'Response / error')).not.toContain('input-only');
    expect(documentFor(view, 'Request')).toContain('10 ms since previous');
    expect(documentFor(view, 'Response / error')).toContain('10 ms since previous');
    expect(documentFor(view, 'Response / error')).toContain('19 ms since previous');
    expect(editors).toHaveLength(2);
  },
);

it('bounds rendering during a frame flood, indicates dropped/truncated frames and preserves initial payloads', async () => {
  const { request, emit, view, capture, sessionId } = setup(100, {
    maxFramesPerRecord: 4,
    previewBytes: 200,
  });
  request('s', 'note.subscribe', { workspaceId: 'w' });
  emit({
    type: 'response',
    key: 's',
    status: 'success',
    payload: { subscriptionId: 'sub' },
    connectionGeneration: 1,
  });
  await waitFor(() => expect(view.getByRole('cell', { name: 'note.subscribe' })).toBeTruthy());
  await fireEvent.click(view.getByRole('cell', { name: 'note.subscribe' }));
  await waitFor(() => expect(documentFor(view, 'Response / error')).toContain('sub'));
  for (let seq = 0; seq < 50; seq++) {
    emit({
      type: 'notification',
      method: 'subscription.push',
      payload: {
        subscriptionId: 'sub',
        kind: 'delta',
        seq,
        delta: { removedIds: [`note-${seq}-` + 'x'.repeat(300)] },
      },
      connectionGeneration: 1,
    });
  }
  await waitFor(() => expect(documentFor(view, 'Response / error')).toContain('note-49-'));
  const response = documentFor(view, 'Response / error');
  expect(response).toContain('"subscriptionId": "sub"');
  expect(response).toContain('note-48-');
  expect(response).not.toContain('note-47-');
  expect(response).toContain('Truncated');
  expect(view.getByRole('status').textContent).toContain('48');
  expect(documentFor(view, 'Request')).toContain('"workspaceId": "w"');
  expect(editors).toHaveLength(2);
  expect(models).toHaveLength(2);
  expect(response.length).toBeLessThan(1600);
  const record = capture.getSnapshot('one', sessionId)!.records[0];
  const row = view.getByRole('cell', { name: 'note.subscribe' }).closest('[role=row]')!;
  expect(row.textContent).toContain(new Intl.NumberFormat('en').format(record.totalBytes!));
});

it('rejects an in-flight streaming refresh after selecting another RPC', async () => {
  const { request, emit, invoke, view } = setup();
  request('a', 'chat.subscribe', { agentId: 'a' });
  emit({
    type: 'response',
    key: 'a',
    status: 'success',
    payload: { subscriptionId: 'sub' },
    connectionGeneration: 1,
  });
  request('b', 'workspace.list', {});
  emit({
    type: 'response',
    key: 'b',
    status: 'success',
    payload: { workspaces: [] },
    connectionGeneration: 1,
  });
  await waitFor(() => expect(view.getByRole('cell', { name: 'chat.subscribe' })).toBeTruthy());
  await fireEvent.click(view.getByRole('cell', { name: 'chat.subscribe' }));
  await waitFor(() => expect(documentFor(view, 'Response / error')).toContain('sub'));
  const originalImpl = invoke.getMockImplementation()!;
  let release: (() => void) | undefined;
  invoke.mockImplementation(async (channel, data) => {
    const result = await originalImpl(channel, data);
    if (channel === 'dev-console:record' && result?.method === 'chat.subscribe')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return result;
  });
  emit({
    type: 'notification',
    method: 'subscription.push',
    payload: {
      subscriptionId: 'sub',
      kind: 'snapshot',
      seq: 0,
      snapshot: { agentId: 'a', messages: [], truncated: false, totalMessages: 0, nextToken: null },
    },
    connectionGeneration: 1,
  });
  await waitFor(() => expect(release).toBeTypeOf('function'));
  await fireEvent.click(view.getByRole('cell', { name: 'workspace.list' }));
  await waitFor(() => expect(documentFor(view, 'Response / error')).toContain('workspaces'));
  release!();
  await Promise.resolve();
  expect(documentFor(view, 'Response / error')).not.toContain('snapshot');
  expect(documentFor(view, 'Request')).not.toContain('agentId');
  expect(documentFor(view, 'Response / error')).toContain('workspaces');
});

it('keeps the interval origin when retention drops a response observed before the original reply', async () => {
  let clock = 0;
  const { request, emit, view } = setup(100, { maxFramesPerRecord: 3, monotonicNow: () => clock });
  request('run', 'host.execStream', { command: 'cat', requestId: 'exec' });
  const output = (chunk: string) =>
    emit({
      type: 'notification',
      method: 'events.event',
      payload: {
        subscriptionId: 'events',
        event: {
          type: 'host:exec:stdout',
          id: 'e',
          workspaceId: 'w',
          timestamp: '2026-10-02T10:00:00Z',
          actor: { type: 'system' },
          data: { requestId: 'exec', chunk },
        },
      },
      connectionGeneration: 1,
    });
  clock = 5;
  output('Zmlyc3Q=');
  clock = 10;
  emit({
    type: 'response',
    key: 'run',
    status: 'success',
    payload: { requestId: 'exec' },
    connectionGeneration: 1,
  });
  clock = 20;
  output('bGFzdA==');
  await waitFor(() => expect(view.getByRole('cell', { name: 'host.execStream' })).toBeTruthy());
  await fireEvent.click(view.getByRole('cell', { name: 'host.execStream' }));
  await waitFor(() => expect(documentFor(view, 'Response / error')).toContain('bGFzdA=='));
  const response = documentFor(view, 'Response / error');
  expect(response).not.toContain('Zmlyc3Q=');
  expect(response).toContain('5 ms since previous');
  expect(response).not.toContain('5 ms since request');
  expect(response).toContain('10 ms since previous');
});
