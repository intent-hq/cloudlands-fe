import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Shell from './DevConsoleShell.svelte';
import { resetMonaco, initializePayloadMonaco } from './__tests__/monaco-mock';
vi.mock('./payload-monaco', () => ({ initializePayloadMonaco: () => initializePayloadMonaco() }));
import { DevConsoleCaptureService } from './main/dev-console-capture';
import { createDaemonLinks } from './main/daemon-links';
import { EventEmitter } from 'node:events';

/**
 * A daemon implementing the documented `remoteLinkTraffic.*` contract
 * (docs/protocol/methods/nodes.md, "Link traffic capture"), reached through the
 * real main-process service and the Dev Console IPC channel shapes.
 */
function fakeDaemon({ supported = true, forbidden = false } = {}) {
  let active = false;
  let records: any[] = [];
  let nextSeq = 1;
  const capture = () => ({
    active,
    ...(active ? { startedAt: '2026-11-03T08:00:00.000Z' } : {}),
    payloads: true,
    maxRecords: 2000,
    maxPayloadBytes: 65536,
    retained: records.length,
    evicted: 0,
    dropped: 2,
    oversized: records.filter((r) => r.truncated).length,
    nextSeq,
  });
  const wire: { method: string; params: unknown }[] = [];
  const events = new EventEmitter();
  let subscription: string | undefined;
  // Every start and stop emits an empty records event with the new capture state.
  const emit = () =>
    subscription &&
    events.emit('notification', {
      method: 'events.event',
      params: {
        subscriptionId: subscription,
        event: { type: 'remoteLinkTraffic:records', data: { records: [], capture: capture() } },
      },
    });
  const client = Object.assign(events, {
    getNodeCapabilities: () => ({ remoteMachines: 1, remoteLinkTraffic: supported ? 1 : 0 }),
    request: async (method: string, params: any) => {
      if (method === 'events.subscribe') return { subscriptionId: (subscription = 'sub-links') };
      if (method === 'events.unsubscribe') return {};
      wire.push({ method, params });
      if (forbidden)
        throw Object.assign(new Error('Forbidden'), { rpcCode: -32003, code: 'FORBIDDEN' });
      if (method === 'remoteLinkTraffic.start' && !active) {
        active = true;
        records = [];
        nextSeq = 1;
      }
      if (method === 'remoteLinkTraffic.stop') {
        active = false;
        records = [];
      }
      if (method === 'remoteLinkTraffic.snapshot') {
        const page = records.filter((r) => r.seq > (params.afterSeq ?? 0));
        return { capture: capture(), records: page.slice(0, params.limit ?? 500) };
      }
      queueMicrotask(emit);
      return { capture: capture() };
    },
  });
  return {
    links: createDaemonLinks((backendId) => (backendId === 'one' ? client : undefined)),
    wire,
    /** Another owner client starts or stops capture on the same daemon. */
    async elsewhere(method: 'remoteLinkTraffic.start' | 'remoteLinkTraffic.stop') {
      await client.request(method, {});
    },
    frame(peer: { kind: string; id: string; name?: string }, extra: Record<string, unknown>) {
      records.push({
        seq: nextSeq++,
        at: '2026-11-03T08:00:01.250Z',
        direction: 'out',
        peer,
        frameType: 'journal',
        bytes: 240,
        summary: 'journal',
        ...extra,
      });
    },
  };
}
const mac = { kind: 'machine', id: 'node-mac', name: 'Mac Studio' };
const box = { kind: 'machine', id: 'node-box', name: 'build-box' };

let daemon: ReturnType<typeof fakeDaemon>;
function mount(options: Parameters<typeof fakeDaemon>[0] = {}) {
  daemon = fakeDaemon(options);
  const capture = new DevConsoleCaptureService();
  const { sessionId } = capture.openSession('one');
  let changed: ((event: { sessionId: string }) => void) | undefined;
  let watching = false;
  const invoke = vi.fn(async (channel: string, data: any) => {
    if (channel === 'dev-console:connect') return { backendId: 'one', sessionId };
    if (channel === 'dev-console:read')
      return capture.getUpdate('one', sessionId, data.afterRevision);
    expect(data.sessionId).toBe(sessionId);
    if (channel === 'dev-console:links-status') {
      // Mirrors the main-process handler: one event watch per console session.
      if (!watching && daemon.links.status('one').supported) {
        watching = true;
        daemon.links.watch('one', () => changed?.({ sessionId }));
      }
      return daemon.links.status('one');
    }
    if (channel === 'dev-console:links-start') return daemon.links.start('one');
    if (channel === 'dev-console:links-stop') return daemon.links.stop('one');
    if (channel === 'dev-console:links-read') return daemon.links.read('one', data.afterSeq);
    if (channel === 'dev-console:links-record') return daemon.links.record('one', data.seq);
    throw new Error(channel);
  });
  window.electronAPI = {
    invoke,
    on: (channel: string, listener: any) => {
      if (channel === 'dev-console:links-changed') changed = listener;
      return channel;
    },
    offById: vi.fn(),
  } as any;
  const view = render(Shell);
  return { view, invoke };
}
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
const linksTab = () => screen.findByRole('tab', { name: 'Daemon links' });
const tableRows = () =>
  within(screen.getByRole('table', { name: 'Daemon links' }))
    .queryAllByRole('row')
    .slice(1);

/** Pick an option with the keyboard, as the canonical Select's own tests do. */
async function choose(name: string, option: string | RegExp) {
  const trigger = screen.getByRole('combobox', { name });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'Enter' });
  await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
  const listbox = document.getElementById(trigger.getAttribute('aria-controls')!)!;
  const options = within(listbox).getAllByRole('option');
  const target = options.findIndex((o) =>
    typeof option === 'string'
      ? o.textContent?.trim() === option
      : option.test(o.textContent ?? ''),
  );
  const current = options.findIndex((o) => o.getAttribute('aria-selected') === 'true');
  for (let i = Math.max(current, 0); i < target; i++)
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await fireEvent.keyDown(trigger, { key: 'Enter' });
  await waitFor(() => expect(trigger.textContent).toMatch(option));
}

describe('Daemon links view', () => {
  it('stays hidden and sends no capture method to an older daemon', async () => {
    const { view } = mount({ supported: false });
    await waitFor(() =>
      expect(view.container.querySelector('[data-dev-console-ready="true"]')).not.toBeNull(),
    );
    await waitFor(() =>
      expect(window.electronAPI.invoke).toHaveBeenCalledWith('dev-console:links-status', {
        sessionId: expect.any(String),
      }),
    );
    expect(screen.queryByRole('tab', { name: 'Daemon links' })).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Console views' })).toBeNull();
    expect(daemon.wire).toEqual([]);
  });

  it('starts capture, lists frames per peer and agent, and stops with a cleared buffer', async () => {
    mount();
    await fireEvent.click(await linksTab());
    expect((await linksTab()).getAttribute('aria-selected')).toBe('true');
    // Capture off: the documented snapshot read, then the start control.
    await waitFor(() =>
      expect(daemon.wire).toContainEqual({
        method: 'remoteLinkTraffic.snapshot',
        params: { limit: 2000 },
      }),
    );
    await fireEvent.click(await screen.findByRole('button', { name: 'Start capture' }));
    expect(daemon.wire).toContainEqual({ method: 'remoteLinkTraffic.start', params: {} });
    daemon.frame(mac, { frameType: 'launch', agentId: 'agent-1', summary: 'launch agent-1' });
    daemon.frame(box, { direction: 'in', agentId: 'agent-2' });
    daemon.frame(mac, { frameType: 'heartbeat' });
    // The next live poll (capture on) picks the frames up incrementally.
    await waitFor(() => expect(tableRows()).toHaveLength(3));
    expect(daemon.wire).toContainEqual({
      method: 'remoteLinkTraffic.snapshot',
      params: { limit: 2000 },
    });
    expect(tableRows()[0].textContent).toContain('Mac Studio');
    expect(tableRows()[0].textContent).toContain('agent-1');
    expect(screen.getByText(/3 shown · 3 retained · 0 evicted · 2 dropped/)).toBeTruthy();

    // Filter by peer, then by remote agent.
    await choose('Peer', /Mac Studio/);
    await waitFor(() => expect(tableRows()).toHaveLength(2));
    await choose('Remote agent', 'agent-1');
    await waitFor(() => expect(tableRows()).toHaveLength(1));
    expect(tableRows()[0].textContent).toContain('launch');

    await fireEvent.click(screen.getByRole('button', { name: 'Stop and clear' }));
    expect(daemon.wire).toContainEqual({ method: 'remoteLinkTraffic.stop', params: {} });
    await waitFor(() => expect(tableRows()).toHaveLength(0));
    expect(screen.getByRole('button', { name: 'Start capture' })).toBeTruthy();
  });

  it('fetches the selected frame on demand and shows its masked payload or why it is absent', async () => {
    const { invoke } = mount();
    await fireEvent.click(await linksTab());
    await fireEvent.click(await screen.findByRole('button', { name: 'Start capture' }));
    daemon.frame(mac, {
      frameType: 'launch',
      payload: { type: 'launch', profileEnv: { env: [{ key: 'API_KEY', value: '***' }] } },
    });
    daemon.frame(mac, { frameType: 'journal', truncated: true });
    await waitFor(() => expect(tableRows()).toHaveLength(2));
    expect(invoke.mock.calls.some(([channel]) => channel === 'dev-console:links-record')).toBe(
      false,
    );
    await fireEvent.click(tableRows()[0]);
    expect(daemon.wire).toContainEqual({
      method: 'remoteLinkTraffic.snapshot',
      params: { afterSeq: 0, limit: 1 },
    });
    const details = await screen.findByRole('region', { name: 'launch' });
    await waitFor(() => expect(details.textContent).toContain('"value": "***"'));
    await fireEvent.click(tableRows()[1]);
    const oversized = await screen.findByRole('region', { name: 'journal' });
    await waitFor(() => expect(oversized.textContent).toMatch(/larger than 65,536 bytes/));
    await fireEvent.click(within(oversized).getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('region', { name: 'journal' })).toBeNull();
  });

  it('explains an owner-only refusal', async () => {
    mount({ forbidden: true });
    await fireEvent.click(await linksTab());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/owner/i);
    expect(alert.textContent).not.toContain('daemon-links:forbidden');
  });

  it('keeps the app traffic view mounted and switches with the keyboard', async () => {
    mount();
    const tab = await linksTab();
    const app = screen.getByRole('tab', { name: 'App traffic' });
    app.focus();
    await fireEvent.keyDown(app, { key: 'ArrowRight' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab);
    // The app traffic inspector stays mounted, only hidden.
    expect(screen.queryByRole('tablist', { name: 'Dev Console' })).toBeNull();
    expect(screen.getByRole('tablist', { name: 'Dev Console', hidden: true })).toBeTruthy();
    await fireEvent.keyDown(tab, { key: 'Home' });
    expect(app.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tablist', { name: 'Dev Console' })).toBeTruthy();
  });

  it('follows another client starting and stopping capture through the records event', async () => {
    mount();
    await fireEvent.click(await linksTab());
    expect(await screen.findByRole('button', { name: 'Start capture' })).toBeTruthy();
    await daemon.elsewhere('remoteLinkTraffic.start');
    expect(await screen.findByRole('button', { name: 'Stop and clear' })).toBeTruthy();
    daemon.frame(mac, { agentId: 'agent-1' });
    await waitFor(() => expect(tableRows()).toHaveLength(1));
    await daemon.elsewhere('remoteLinkTraffic.stop');
    expect(await screen.findByRole('button', { name: 'Start capture' })).toBeTruthy();
    expect(tableRows()).toHaveLength(0);
  });
});
