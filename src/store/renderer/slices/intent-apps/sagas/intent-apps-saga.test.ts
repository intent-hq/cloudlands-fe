import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import type { IntentApp, IntentAppsState } from '$shared/intent-apps/intent-apps-types';
import {
  intentAppApproveRequested,
  intentAppInstallRequested,
  intentAppOpenRequested,
  intentAppsLabRequested,
  intentAppsReducer,
  intentAppUninstallRequested,
} from '../intent-apps-slice';
import { intentAppsSaga } from './intent-apps-saga';

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

const APP = {
  id: 'pomodoro-timer',
  name: 'Pomodoro Timer',
  version: '1.0.0',
  description: null,
  icon: 'icon.png',
  entry: 'index.html',
  bundleHash: 'sha256:9f2c',
  fileCount: 4,
  sizeBytes: 18234,
  permissions: { level: 2, features: ['models'] },
  window: { width: 960, height: 640, minWidth: null, minHeight: null, resizable: true, alwaysOnTop: false },
  approval: { status: 'pending', level: null, features: [], bundleHash: null, approvedAt: null },
  source: { workspaceId: 'ws-1', path: 'apps/pomodoro' },
  installedAt: '2026-11-26T11:59:00.000Z',
  updatedAt: '2026-11-26T11:59:00.000Z',
  open: false,
} satisfies IntentApp;

const libraryState = (overrides: Partial<IntentAppsState> = {}): IntentAppsState => ({
  labEnabled: true,
  supported: true,
  apps: [APP],
  openAppIds: [],
  error: null,
  ...overrides,
});

/** A stand-in for main: answers each channel and can push `intent-apps:changed`. */
function installMain(answers: Record<string, (payload: any) => unknown>) {
  const listeners = new Map<string, (payload: any) => void>();
  const invoke = vi.fn(async (channel: string, payload?: unknown) => answers[channel]?.(payload));
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    invoke,
    on: vi.fn((channel: string, listener: (payload: any) => void) => {
      listeners.set(channel, listener);
      return 'listener-1';
    }),
    offById: vi.fn(),
  };
  return { invoke, push: (state: IntentAppsState) => listeners.get('intent-apps:changed')?.(state) };
}

function createHarness() {
  let state = { intentApps: intentAppsReducer(undefined, { type: '@@INIT' } as never) };
  const channel = stdChannel();
  const dispatch = vi.fn((action: any) => {
    state = { intentApps: intentAppsReducer(state.intentApps, action) };
    channel.put(action);
    return action;
  });
  const task = runSaga({ channel, dispatch, getState: () => state }, intentAppsSaga);
  return { dispatch, task, getState: () => state };
}

describe('intentAppsSaga', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('reads the library from main, follows its pushes and loads icons', async () => {
    const main = installMain({
      'intent-apps:get-state': () => libraryState(),
      'intent-apps:icon': () => 'data:image/png;base64,iVBO',
    });
    const { task, getState } = createHarness();
    await settle();
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:get-state', {});
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:icon', { appId: 'pomodoro-timer' });
    expect(getState().intentApps.library.apps).toEqual([APP]);
    expect(getState().intentApps.icons['pomodoro-timer@sha256:9f2c']).toBe(
      'data:image/png;base64,iVBO',
    );
    main.push(libraryState({ apps: [], openAppIds: [] }));
    await settle();
    expect(getState().intentApps.library.apps).toEqual([]);
    task.cancel();
  });

  it('sends each user request on its channel with the exact payload', async () => {
    const main = installMain({
      'intent-apps:get-state': () => libraryState(),
      'intent-apps:set-lab': () => libraryState({ labEnabled: false }),
      'intent-apps:install': () => ({
        ok: true,
        result: { app: APP, replaced: false, approvalReset: false, dryRun: true },
      }),
      'intent-apps:approve': () => ({ ok: true, result: { app: APP } }),
      'intent-apps:uninstall': () => ({ ok: true, result: { removed: true } }),
      'intent-apps:open': () => ({ ok: true }),
    });
    const { dispatch, task, getState } = createHarness();
    await settle();

    dispatch(intentAppInstallRequested({ workspaceId: 'ws-1', path: 'apps/pomodoro', dryRun: true }));
    await settle();
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:install', {
      workspaceId: 'ws-1',
      path: 'apps/pomodoro',
      dryRun: true,
    });
    expect(getState().intentApps.installPreview?.app.id).toBe('pomodoro-timer');

    dispatch(
      intentAppApproveRequested({
        appId: 'pomodoro-timer',
        bundleHash: 'sha256:9f2c',
        level: 2,
        features: ['models'],
      }),
    );
    dispatch(intentAppUninstallRequested('pomodoro-timer'));
    dispatch(intentAppOpenRequested('pomodoro-timer'));
    dispatch(intentAppsLabRequested(false));
    await settle();
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:approve', {
      appId: 'pomodoro-timer',
      bundleHash: 'sha256:9f2c',
      level: 2,
      features: ['models'],
    });
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:uninstall', { appId: 'pomodoro-timer' });
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:open', { appId: 'pomodoro-timer' });
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:set-lab', { enabled: false });
    expect(getState().intentApps.library.labEnabled).toBe(false);
    expect(getState().intentApps.busy).toBeNull();
    task.cancel();
  });

  it('records a refusal with the daemon code for the dialog', async () => {
    installMain({
      'intent-apps:get-state': () => libraryState(),
      'intent-apps:install': () => ({
        ok: false,
        error: { code: 'app-exists', message: 'App exists' },
      }),
    });
    const { dispatch, task, getState } = createHarness();
    await settle();
    dispatch(intentAppInstallRequested({ workspaceId: 'ws-1', path: '.', dryRun: true }));
    await settle();
    expect(getState().intentApps.failure).toEqual({
      kind: 'install',
      appId: null,
      error: { code: 'app-exists', message: 'App exists' },
    });
    expect(getState().intentApps.installPreview).toBeNull();
    task.cancel();
  });
});
