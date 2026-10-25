import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  subscribeScriptMonitors: vi.fn(),
  createScriptMonitorConnection: vi.fn(),
}));
vi.mock('$features/script-monitor/script-monitor-service', () => ({
  subscribeScriptMonitors: mocks.subscribeScriptMonitors,
  createScriptMonitorConnection: mocks.createScriptMonitorConnection,
}));
vi.mock('$features/script-monitor/open-monitored-script', () => ({ openMonitoredScript: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { info: vi.fn() } }));

import type { ScriptMonitorSnapshot } from '$features/script-monitor/script-monitor-service';
import { monitorSummaryFixture as summary } from '$features/script-monitor/script-monitor.fixture';
import {
  scriptMonitorReducer,
  scriptMonitorsSubscribeRequested,
  scriptMonitorsUnsubscribeRequested,
} from '../script-monitor-slice';
import { openWorkspaceTab, tabStateReducer } from '../../tab-state/tab-state-slice';
import { scriptMonitorSaga } from './script-monitor-saga';

type Emit = (snapshot: ScriptMonitorSnapshot) => void;

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function createHarness(currentTabId: string | null = null) {
  let state = {
    tabState: tabStateReducer(undefined, { type: '@@INIT' }),
    scriptMonitor: scriptMonitorReducer(undefined, { type: '@@INIT' }),
  };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: { type: string }) => {
    state = {
      tabState: tabStateReducer(state.tabState, action as never),
      scriptMonitor: scriptMonitorReducer(state.scriptMonitor, action as never),
    };
    channel.put(action);
    for (const listener of listeners) listener();
    return action;
  });
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    scriptMonitorSaga,
  );
  if (currentTabId !== null) dispatch(openWorkspaceTab(currentTabId));
  return { dispatch, getState: () => state, task };
}

const subscribedWorkspaces = () => mocks.subscribeScriptMonitors.mock.calls.map((call) => call[0]);
const disposeOf = (index: number) =>
  mocks.subscribeScriptMonitors.mock.results[index].value.dispose as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.createScriptMonitorConnection.mockReturnValue({ dispose: vi.fn() });
  mocks.subscribeScriptMonitors.mockImplementation(() => ({ dispose: vi.fn() }));
});
afterEach(() => vi.useRealTimers());

describe('scriptMonitorSaga lease reopen', () => {
  it('passes the last ready rows to a reopened lease', async () => {
    const h = createHarness();
    try {
      h.dispatch(scriptMonitorsSubscribeRequested('ws'));
      const ready: ScriptMonitorSnapshot = { monitors: [summary], scripts: [], status: 'ready' };
      (mocks.subscribeScriptMonitors.mock.calls[0][1] as Emit)(ready);
      await settle();
      expect(mocks.subscribeScriptMonitors.mock.calls[0][3]).toBeUndefined();
      h.dispatch(scriptMonitorsUnsubscribeRequested('ws'));
      expect(disposeOf(0)).toHaveBeenCalledOnce();

      h.dispatch(scriptMonitorsSubscribeRequested('ws'));
      expect(mocks.subscribeScriptMonitors.mock.calls[1][3]).toMatchObject({
        monitors: [summary],
        status: 'ready',
      });
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  });

  it('does not pass rows that were never confirmed by a ready read', async () => {
    const h = createHarness();
    try {
      h.dispatch(scriptMonitorsSubscribeRequested('ws'));
      (mocks.subscribeScriptMonitors.mock.calls[0][1] as Emit)({
        monitors: [summary],
        scripts: [],
        status: 'failed',
      });
      await settle();
      h.dispatch(scriptMonitorsUnsubscribeRequested('ws'));
      h.dispatch(scriptMonitorsSubscribeRequested('ws'));
      expect(mocks.subscribeScriptMonitors.mock.calls[1][3]).toBeUndefined();
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  });
});
