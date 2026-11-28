import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import type { IntentApp, IntentAppsState } from '$shared/intent-apps/intent-apps-types';
import {
  intentAppApproveRequested,
  intentAppOpenRequested,
  intentAppPackageChosen,
  intentAppPackageDismissed,
  intentAppPackageInstallRequested,
  intentAppPackagePickRequested,
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
  window: {
    width: 960,
    height: 640,
    minWidth: null,
    minHeight: null,
    resizable: true,
    alwaysOnTop: false,
  },
  approval: { status: 'pending', level: null, features: [], bundleHash: null, approvedAt: null },
  source: { workspaceId: 'ws-1', path: 'apps/pomodoro' },
  publisher: null,
  updateUrl: null,
  signature: null,
  installedAt: '2026-11-26T11:59:00.000Z',
  updatedAt: '2026-11-26T11:59:00.000Z',
  open: false,
} satisfies IntentApp;

/** An `app.install` result for the APP package. */
const checkResult = (dryRun = true) => ({
  app: APP,
  replaced: false,
  approvalReset: false,
  dryRun,
});

const libraryState = (overrides: Partial<IntentAppsState> = {}): IntentAppsState => ({
  labEnabled: true,
  supported: true,
  packages: true,
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
  return {
    invoke,
    push: (state: IntentAppsState) => listeners.get('intent-apps:changed')?.(state),
  };
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

  it('with the Labs switch off, reads the state once and sends nothing else', async () => {
    const main = installMain({
      'intent-apps:get-state': () => ({
        labEnabled: false,
        supported: false,
        packages: false,
        apps: [],
        openAppIds: [],
        error: null,
      }),
    });
    const { task, getState } = createHarness();
    await settle();
    expect(main.invoke.mock.calls).toEqual([['intent-apps:get-state', {}]]);
    expect(getState().intentApps.library.labEnabled).toBe(false);
    task.cancel();
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
      'intent-apps:approve': () => ({ ok: true, result: { app: APP } }),
      'intent-apps:uninstall': () => ({ ok: true, result: { removed: true } }),
      'intent-apps:open': () => ({ ok: true }),
    });
    const { dispatch, task, getState } = createHarness();
    await settle();

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

  it('picks a package, checks it, then installs and approves the checked bundle', async () => {
    const main = installMain({
      'intent-apps:get-state': () => libraryState({ apps: [] }),
      'intent-apps:pick-package': () => ({ path: '/home/me/Downloads/pomodoro.intentapp' }),
      'intent-apps:install': (payload: { dryRun?: boolean }) => ({
        ok: true,
        result: {
          app: APP,
          replaced: false,
          approvalReset: false,
          dryRun: payload.dryRun === true,
          uploadId: 'upload-1',
        },
      }),
      'intent-apps:approve': () => ({ ok: true, result: { app: APP } }),
      'intent-apps:discard-package': () => ({ ok: true }),
    });
    const { dispatch, task, getState } = createHarness();
    await settle();

    dispatch(intentAppPackagePickRequested());
    await settle();
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:pick-package', {});
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:install', {
      path: '/home/me/Downloads/pomodoro.intentapp',
      dryRun: true,
    });
    expect(getState().intentApps.packageInstall).toMatchObject({
      uploadId: 'upload-1',
      replace: false,
      preview: { app: { id: 'pomodoro-timer' } },
    });

    dispatch(intentAppPackageInstallRequested(['models']));
    await settle();
    await settle();
    // The install uses the checked upload: the user installs what they reviewed.
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:install', {
      uploadId: 'upload-1',
      replace: false,
    });
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:approve', {
      appId: 'pomodoro-timer',
      bundleHash: 'sha256:9f2c',
      level: 2,
      features: ['models'],
    });
    expect(getState().intentApps.packageInstall).toBeNull();
    task.cancel();
  });

  it('turns an app-exists check into a replace check', async () => {
    const main = installMain({
      'intent-apps:get-state': () => libraryState(),
      'intent-apps:install': (payload: { replace?: boolean }) =>
        payload.replace
          ? {
              ok: true,
              result: {
                app: APP,
                replaced: true,
                approvalReset: true,
                dryRun: true,
                uploadId: 'upload-1',
              },
            }
          : {
              ok: false,
              error: { code: 'app-exists', message: 'App exists', uploadId: 'upload-1' },
            },
    });
    const { dispatch, task, getState } = createHarness();
    await settle();
    dispatch(intentAppPackageChosen('/tmp/pomodoro'));
    await settle();
    // The replace check reuses the upload instead of sending the package again.
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:install', {
      uploadId: 'upload-1',
      dryRun: true,
      replace: true,
    });
    expect(getState().intentApps.packageInstall?.replace).toBe(true);
    expect(getState().intentApps.failure).toBeNull();
    task.cancel();
  });

  it('does not approve when the installed bundle differs from the checked one', async () => {
    const main = installMain({
      'intent-apps:get-state': () => libraryState({ apps: [] }),
      'intent-apps:install': (payload: { dryRun?: boolean }) => ({
        ok: true,
        result: {
          app: payload.dryRun ? APP : { ...APP, bundleHash: 'sha256:other' },
          replaced: false,
          approvalReset: false,
          dryRun: payload.dryRun === true,
          uploadId: 'upload-1',
        },
      }),
    });
    const { dispatch, task, getState } = createHarness();
    await settle();
    dispatch(intentAppPackageChosen('/tmp/pomodoro'));
    await settle();
    dispatch(intentAppPackageInstallRequested(['models']));
    await settle();
    expect(main.invoke).not.toHaveBeenCalledWith('intent-apps:approve', expect.anything());
    expect(getState().intentApps.failure?.error.code).toBe('hash-mismatch');
    task.cancel();
  });

  it('discards the upload when the user closes the review, and after a failed check', async () => {
    const main = installMain({
      'intent-apps:get-state': () => libraryState(),
      'intent-apps:install': () => ({
        ok: false,
        error: { code: 'invalid-package', message: 'no manifest', uploadId: 'upload-9' },
      }),
      'intent-apps:discard-package': () => ({ ok: true }),
    });
    const { dispatch, task } = createHarness();
    await settle();
    dispatch(intentAppPackageChosen('/tmp/broken.zip'));
    await settle();
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:discard-package', {
      uploadId: 'upload-9',
    });
    main.invoke.mockClear();
    dispatch(intentAppPackageDismissed('upload-3'));
    await settle();
    expect(main.invoke).toHaveBeenCalledWith('intent-apps:discard-package', {
      uploadId: 'upload-3',
    });
    task.cancel();
  });

  it('checks one package at a time: a second drop during a check starts no upload', async () => {
    let release: (value: unknown) => void = () => {};
    const main = installMain({
      'intent-apps:get-state': () => libraryState(),
      'intent-apps:install': () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const { dispatch, task, getState } = createHarness();
    await settle();
    dispatch(intentAppPackageChosen('/tmp/a.intentapp'));
    await settle();
    dispatch(intentAppPackageChosen('/tmp/b.intentapp'));
    await settle();
    release({ ok: true, result: { ...checkResult(), uploadId: 'upload-a' } });
    await settle();
    const installs = main.invoke.mock.calls.filter(
      ([channel]) => channel === 'intent-apps:install',
    );
    expect(installs).toEqual([['intent-apps:install', { path: '/tmp/a.intentapp', dryRun: true }]]);
    expect(getState().intentApps.packageInstall?.uploadId).toBe('upload-a');
    task.cancel();
  });

  it('retries only the approval after the install succeeded and the approval failed', async () => {
    let approveAnswers = 0;
    const main = installMain({
      'intent-apps:get-state': () => libraryState({ apps: [] }),
      'intent-apps:install': (payload: { dryRun?: boolean }) => ({
        ok: true,
        result: { ...checkResult(payload.dryRun === true), uploadId: 'upload-1' },
      }),
      'intent-apps:approve': () =>
        approveAnswers++ === 0
          ? { ok: false, error: { code: 'internal', message: 'disconnected' } }
          : { ok: true, result: { app: APP } },
    });
    const { dispatch, task, getState } = createHarness();
    await settle();
    dispatch(intentAppPackageChosen('/tmp/pomodoro'));
    await settle();
    dispatch(intentAppPackageInstallRequested(['models']));
    await settle();
    expect(getState().intentApps.packageInstall).toMatchObject({ installed: true });
    expect(getState().intentApps.failure?.kind).toBe('approve');

    dispatch(intentAppPackageInstallRequested(['models']));
    await settle();
    const installs = main.invoke.mock.calls.filter(
      ([channel, payload]) =>
        channel === 'intent-apps:install' && !(payload as { dryRun?: boolean }).dryRun,
    );
    expect(installs).toHaveLength(1);
    expect(
      main.invoke.mock.calls.filter(([channel]) => channel === 'intent-apps:approve'),
    ).toHaveLength(2);
    expect(getState().intentApps.packageInstall).toBeNull();
    task.cancel();
  });

  it('does not approve or close a newer review when a dismissed install answers late', async () => {
    let releaseInstall: (value: unknown) => void = () => {};
    let checks = 0;
    const main = installMain({
      'intent-apps:get-state': () => libraryState({ apps: [] }),
      'intent-apps:install': (payload: { dryRun?: boolean }) =>
        payload.dryRun
          ? { ok: true, result: { ...checkResult(), uploadId: `upload-${++checks}` } }
          : new Promise((resolve) => {
              releaseInstall = resolve;
            }),
      'intent-apps:approve': () => ({ ok: true, result: { app: APP } }),
      'intent-apps:discard-package': () => ({ ok: true }),
    });
    const { dispatch, task, getState } = createHarness();
    await settle();
    dispatch(intentAppPackageChosen('/tmp/a.intentapp'));
    await settle();
    dispatch(intentAppPackageInstallRequested(['models']));
    await settle();
    dispatch(intentAppPackageDismissed('upload-1'));
    dispatch(intentAppPackageChosen('/tmp/b.intentapp'));
    await settle();
    expect(getState().intentApps.packageInstall?.uploadId).toBe('upload-2');

    releaseInstall({ ok: true, result: { ...checkResult(false), uploadId: 'upload-1' } });
    await settle();
    expect(main.invoke).not.toHaveBeenCalledWith('intent-apps:approve', expect.anything());
    expect(getState().intentApps.packageInstall?.uploadId).toBe('upload-2');
    task.cancel();
  });

  it('records a refusal with the daemon code for the dialog', async () => {
    installMain({
      'intent-apps:get-state': () => libraryState(),
      'intent-apps:install': () => ({
        ok: false,
        error: { code: 'not-a-package', message: 'not an app package: notes.txt' },
      }),
    });
    const { dispatch, task, getState } = createHarness();
    await settle();
    dispatch(intentAppPackageChosen('/tmp/notes.txt'));
    await settle();
    expect(getState().intentApps.failure).toEqual({
      kind: 'install',
      appId: null,
      error: { code: 'not-a-package', message: 'not an app package: notes.txt' },
    });
    expect(getState().intentApps.packageInstall).toBeNull();
    task.cancel();
  });
});
