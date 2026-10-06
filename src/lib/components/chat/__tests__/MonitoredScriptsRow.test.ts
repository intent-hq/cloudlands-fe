import EventSubscriptionsCard from '../EventSubscriptionsCard.svelte';
import { setEventSubscriptionsExpanded } from '../agent-subscriptions-view-state';
import { setSubscriptionSnapshot } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
/** Real monitor transport, saga, selectors, row, and navigation. Only the daemon is mocked. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backendRequest,
  backendSubscribe,
  onBackendNotification,
  onBackendReconnected,
  type BackendNotification,
} from '$lib/client/live/backend-transport';
import { store } from '$store/renderer/store';
import { scriptMonitorSaga } from '$store/renderer/slices/script-monitor/sagas/script-monitor-saga';
import {
  scriptMonitorActionRequested,
  scriptMonitorsSubscribeRequested,
  scriptMonitorsUnsubscribeRequested,
} from '$store/renderer/slices/script-monitor/script-monitor-slice';
import { selectScriptMonitors } from '$store/renderer/slices/script-monitor/script-monitor-selectors';
import { removeWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { selectWorkspaceTerminalState } from '$store/renderer/slices/terminals/terminals-selectors';
import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
import {
  monitorFixture as active,
  scriptFixture,
} from '$features/script-monitor/script-monitor.fixture';
import { notify } from '$lib/components/patterns/notify';
import MonitoredScriptsRow from '../MonitoredScriptsRow.svelte';
import type { ScriptMonitor } from '$features/script-monitor/types';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn().mockResolvedValue(undefined),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../AgentSubscriptions.svelte', async () => ({
  default: (await import('./mocks/MockAgentEventSection.svelte')).default,
}));
vi.mock('../BackgroundHooksRow.svelte', async () => ({
  default: (await import('./mocks/MockHookEventSection.svelte')).default,
}));
vi.mock('../MonitoredPrsRow.svelte', async () => ({
  default: (await import('./mocks/MockPrEventSection.svelte')).default,
}));
const ws = active.workspaceId;
let stop: () => void;
let emit: (event: BackendNotification) => void;
let reconnect: () => void;
let monitors: ScriptMonitor[];
let scripts = [scriptFixture];
let supported = true;
const clipboardWriteText = vi.fn();
const settled: ScriptMonitor = {
  ...active,
  state: 'completed',
  reason: 'finished',
  settledAt: '2026-10-02T10:01:00Z',
  result: { outcome: 'cancelled', stoppedAt: '2026-10-02T10:01:00Z', error: 'User cancelled' },
};
beforeAll(() => store.init());
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, {
    clipboard: { writeText: clipboardWriteText.mockResolvedValue(undefined) },
  });
  supported = true;
  monitors = [active];
  scripts = [scriptFixture];
  vi.mocked(onBackendNotification).mockImplementation((fn) => {
    emit = fn;
    return vi.fn();
  });
  vi.mocked(onBackendReconnected).mockImplementation((fn) => {
    reconnect = fn;
    return vi.fn();
  });
  vi.mocked(backendSubscribe).mockResolvedValue({ subscriptionId: 'sub' });
  vi.mocked(backendRequest).mockImplementation(async (method) => {
    if (method === 'client.hello')
      return {
        server: { capabilities: { scriptMonitors: supported ? 1 : undefined, scriptLifecycle: 1 } },
      };
    if (method === 'scriptMonitor.list') return { monitors };
    if (method === 'script.list') return { scripts };
    if (method === 'scriptMonitor.cancelRun')
      return { ok: true, monitor: settled, runStopped: true };
    if (method === 'scriptMonitor.cancel')
      return {
        ok: true,
        monitor: {
          ...active,
          state: 'cancelled',
          reason: 'unmonitored',
          settledAt: settled.settledAt,
        },
      };
    throw new Error(`Unexpected call: ${method}`);
  });
  stop = store.runSaga(scriptMonitorSaga);
});
afterEach(() => {
  cleanup();
  stop();
  store.dispatch(removeWorkspaceEntity(ws));
});
async function mount() {
  store.dispatch(scriptMonitorsSubscribeRequested(ws));
  render(MonitoredScriptsRow, { workspaceId: ws, agentId: active.agentId });
  await waitFor(() =>
    expect(selectScriptMonitors.select(store.state, ws).status).toBe(
      supported ? 'ready' : 'unsupported',
    ),
  );
}
async function menu() {
  await fireEvent.click(await screen.findByRole('button', { name: /Actions for/ }));
}
function event(row: ScriptMonitor) {
  emit({
    method: 'events.event',
    params: {
      subscriptionId: 'sub',
      event: { workspaceId: ws, type: `scriptMonitor:${row.state}`, data: { monitor: row } },
    },
  });
}
describe('script monitor controls', () => {
  it('discloses and copies the full current command verbatim, then hides it on collapse', async () => {
    const command = '  pnpm test --filter "chat <footer> & scripts"\n    --reporter=verbose  ';
    scripts = [{ ...scriptFixture, command }];
    await mount();
    expect(screen.queryByTestId('script-monitor-command')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy command' })).toBeNull();
    const disclosure = screen.getAllByRole('button', { name: active.scriptName })[0];
    await fireEvent.click(disclosure);
    expect(screen.getByTestId('script-monitor-command').textContent).toBe(command);
    await fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    expect(clipboardWriteText).toHaveBeenCalledWith(command);
    await screen.findByRole('button', { name: 'Copied' });
    await fireEvent.click(disclosure);
    await waitFor(() => expect(screen.queryByTestId('script-monitor-command')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  });
  it('reports a clipboard failure and lets the user retry without collapsing details', async () => {
    await mount();
    await fireEvent.click(screen.getAllByRole('button', { name: active.scriptName })[0]);
    clipboardWriteText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    await fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
    expect(screen.getByTestId('script-monitor-command').textContent).toBe(scriptFixture.command);
    await fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(clipboardWriteText).toHaveBeenCalledTimes(2);
  });
  it.each(['', '  \n  '])('omits an empty command and copy control (%j)', async (command) => {
    scripts = [{ ...scriptFixture, command }];
    await mount();
    await fireEvent.click(screen.getAllByRole('button', { name: active.scriptName })[0]);
    expect(screen.queryByTestId('script-monitor-command')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy command' })).toBeNull();
    expect(screen.getByText(/Monitoring ends at/)).toBeTruthy();
  });
  it('omits command details and copying when the script is no longer available', async () => {
    scripts = [];
    await mount();
    await fireEvent.click(screen.getAllByRole('button', { name: active.scriptName })[0]);
    expect(screen.queryByTestId('script-monitor-command')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy command' })).toBeNull();
    expect(screen.getByText(/script is no longer available/)).toBeTruthy();
  });

  it('updates collapsed chat counters and retires every terminal kind without remounting the rows', async () => {
    monitors = [active, { ...active, monitorId: 'second', scriptId: 'build' }];
    store.dispatch(
      setSubscriptionSnapshot(ws, active.agentId, {
        subscriptions: [],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'idle',
      }),
    );
    setEventSubscriptionsExpanded(ws, active.agentId, false);
    render(EventSubscriptionsCard, { workspaceId: ws, agentId: active.agentId });
    const summary = await screen.findByTestId('event-subscriptions-summary');
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(summary.textContent).toContain('2');
    event({ ...active, state: 'expired', reason: 'ttl-expired', settledAt: settled.settledAt });
    event({
      ...active,
      monitorId: 'second',
      scriptId: 'build',
      state: 'cancelled',
      reason: 'owner-deleted',
      settledAt: settled.settledAt,
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('subscription-utility-area').getAttribute('data-has-subscriptions'),
      ).toBe('false'),
    );
  });
  it('opens optional conditions and TTL without reading output; projects only its owner', async () => {
    monitors.push({
      ...active,
      monitorId: 'other',
      agentId: 'other-owner',
      scriptName: 'Private other row',
    });
    await mount();
    expect(screen.queryByText('Private other row')).toBeNull();
    await fireEvent.click(screen.getAllByRole('button', { name: active.scriptName })[0]);
    expect(screen.getByText(/Monitoring ends at/)).toBeTruthy();
    expect(screen.getByText(/\^Tests:/)).toBeTruthy();
    expect(screen.getByText(/200 new lines/)).toBeTruthy();
    expect(screen.queryByText(/later run/)).toBeNull();
    expect(screen.queryByText(active.runId)).toBeNull();
    expect(backendRequest).not.toHaveBeenCalledWith('script.output', expect.anything());
  });
  it('explains replaced output only when the current run differs', async () => {
    scripts = [
      {
        ...scriptFixture,
        command: 'pnpm replacement-check',
        runtime: { ...scriptFixture.runtime, runId: 'replacement' },
      },
    ];
    await mount();
    await fireEvent.click(screen.getAllByRole('button', { name: active.scriptName })[0]);
    expect(screen.getByText(/later run/)).toBeTruthy();
    expect(screen.getByTestId('script-monitor-command').textContent).toBe('pnpm replacement-check');
    expect(screen.getByTestId('script-monitor-command').getAttribute('aria-label')).toBe(
      'Current script command',
    );
    await menu();
    await fireEvent.click(screen.getByText('Cancel run and notify agent'));
    await waitFor(() =>
      expect(backendRequest).toHaveBeenCalledWith('scriptMonitor.cancelRun', {
        workspaceId: ws,
        monitorId: active.monitorId,
      }),
    );
  });
  it('opens archived scripts in both placements, reusing the pane, without starting a run', async () => {
    scripts = [{ ...scriptFixture, archivedAt: '2026-10-02T10:01:00Z' }];
    await mount();
    for (let i = 0; i < 2; i++) {
      await menu();
      await fireEvent.click(screen.getByRole('menuitem', { name: /panel/i }));
    }
    await waitFor(() =>
      expect(
        getPanelLayoutManager(ws)
          .getAllTabs()
          .filter((tab) => tab.scriptId === active.scriptId),
      ).toHaveLength(1),
    );
    await menu();
    await fireEvent.click(screen.getByRole('menuitem', { name: /bottom/i }));
    await waitFor(() =>
      expect(selectWorkspaceTerminalState.select(store.state, ws)).toMatchObject({
        isOpen: true,
        selectedScriptId: active.scriptId,
      }),
    );
    expect(backendRequest).not.toHaveBeenCalledWith('script.start', expect.anything());
    expect(backendRequest).not.toHaveBeenCalledWith('script.restart', expect.anything());
  });
  it('disables script navigation when its definition is gone', async () => {
    scripts = [];
    await mount();
    await menu();
    expect(screen.getByRole('menuitem', { name: /panel/i }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(screen.getByRole('menuitem', { name: /bottom/i }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });
  it('shows pending cancellation, sends only the monitor identity, and retires after daemon settlement', async () => {
    await mount();
    let resolve!: (value: unknown) => void;
    vi.mocked(backendRequest).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await menu();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Cancel run/ }));
    await waitFor(() => expect(screen.getByText('Stopping…')).toBeTruthy());
    expect(backendRequest).toHaveBeenLastCalledWith('scriptMonitor.cancelRun', {
      workspaceId: ws,
      monitorId: active.monitorId,
    });
    resolve({ ok: true, monitor: settled, runStopped: true });
    await waitFor(() => expect(screen.queryByTestId('script-monitor-row')).toBeNull());
    expect(notify.info).toHaveBeenCalled();
  });
  it('keeps a failed action visible and retryable; stop-monitoring is distinct from stop-run', async () => {
    await mount();
    vi.mocked(backendRequest).mockRejectedValueOnce(new Error('stop failed'));
    await menu();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Cancel run/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    await menu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Stop monitoring' }));
    await waitFor(() => expect(screen.queryByTestId('script-monitor-row')).toBeNull());
    expect(backendRequest).toHaveBeenLastCalledWith('scriptMonitor.cancel', {
      workspaceId: ws,
      monitorId: active.monitorId,
    });
  });
  it('cannot use a stale menu to stop a replacement after a trigger wins', async () => {
    await mount();
    await menu();
    event({
      ...active,
      state: 'triggered',
      reason: 'line-count',
      settledAt: settled.settledAt,
      trigger: { observedLineCount: 200 },
    });
    await waitFor(() => expect(screen.queryByTestId('script-monitor-row')).toBeNull());
    store.dispatch(scriptMonitorActionRequested(ws, active.monitorId, 'cancelRun'));
    expect(backendRequest).not.toHaveBeenCalledWith('scriptMonitor.cancelRun', expect.anything());
    expect(backendRequest).not.toHaveBeenCalledWith('script.stop', expect.anything());
  });
  it('shares mounted leases, clears cleanup events, and does not resurrect on reconnect', async () => {
    await mount();
    store.dispatch(scriptMonitorsSubscribeRequested(ws));
    expect(backendSubscribe).toHaveBeenCalledTimes(1);
    event({
      ...active,
      state: 'cancelled',
      reason: 'workspace-archived',
      settledAt: settled.settledAt,
    });
    await waitFor(() => expect(screen.queryByTestId('script-monitor-row')).toBeNull());
    monitors = [];
    reconnect();
    await waitFor(() => expect(selectScriptMonitors.select(store.state, ws).status).toBe('ready'));
    expect(selectScriptMonitors.select(store.state, ws).monitors).toEqual([]);
    store.dispatch(scriptMonitorsUnsubscribeRequested(ws));
  });
  it('hides controls entirely on old daemons', async () => {
    supported = false;
    await mount();
    expect(screen.queryByTestId('script-monitor-row')).toBeNull();
    expect(backendSubscribe).not.toHaveBeenCalled();
  });
});
