import { expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import type { ScriptMonitorSnapshot } from '$features/script-monitor/script-monitor-service';

const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), dispose: vi.fn() }));
vi.mock('$features/script-monitor/script-monitor-service', () => ({
  subscribeScriptMonitors: mocks.subscribe,
  createScriptMonitorConnection: () => ({ dispose: mocks.dispose }),
}));
vi.mock('$features/script-monitor/open-monitored-script', () => ({ openMonitoredScript: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { info: vi.fn() } }));
import { scriptMonitorSaga } from './script-monitor-saga';
import {
  scriptMonitorReducer,
  scriptMonitorsSubscribeRequested,
  scriptMonitorsUnsubscribeRequested,
} from '../script-monitor-slice';

it('commits snapshots before the service callback returns and rejects released lease callbacks', async () => {
  const channel = stdChannel();
  let state = { scriptMonitor: scriptMonitorReducer(undefined, { type: '@@init' }) };
  const dispatch = (action: { type: string }) => {
    state = { scriptMonitor: scriptMonitorReducer(state.scriptMonitor, action) };
    channel.put(action);
    return action;
  };
  const snapshot: ScriptMonitorSnapshot = { monitors: [], scripts: [], status: 'ready' };
  let listener!: (snapshot: ScriptMonitorSnapshot) => void;
  const dispose = vi.fn();
  mocks.subscribe.mockImplementation((_id, handler) => {
    listener = handler;
    handler(snapshot);
    expect(state.scriptMonitor.byWorkspaceId.ws.status).toBe('ready');
    return { dispose };
  });
  const task = runSaga(
    { channel, dispatch, getState: () => state, context: { reduxStore: { dispatch } } },
    scriptMonitorSaga,
  );
  try {
    dispatch(scriptMonitorsSubscribeRequested('ws'));
    dispatch(scriptMonitorsSubscribeRequested('ws'));
    expect(mocks.subscribe).toHaveBeenCalledOnce();
    dispatch(scriptMonitorsUnsubscribeRequested('ws'));
    expect(dispose).not.toHaveBeenCalled();
    dispatch(scriptMonitorsUnsubscribeRequested('ws'));
    expect(dispose).toHaveBeenCalledOnce();
    listener({ ...snapshot, status: 'failed' });
    expect(state.scriptMonitor.byWorkspaceId.ws.status).toBe('ready');
  } finally {
    task.cancel();
    await task.toPromise();
  }
});
