import { describe, expect, it } from 'vitest';
import type { AutoUpdateState } from './auto-update-types';
import {
  autoUpdateReducer,
  dismissDownloadedToast,
  hideToast,
  setCheckTimedOut,
  setProgress,
  setUpdateError,
  setUpdateState,
  setUpToDate,
  showToast,
  showToastChecking,
  simulateSetState,
} from './auto-update-slice';

const baseState: AutoUpdateState = {
  status: 'idle',
  currentVersion: '1.0.0',
  updateInfo: null,
  progress: null,
  error: null,
  channel: 'stable',
  toastVisible: false,
  downloadedToastDismissedAt: null,
};

describe('auto-update-slice reducer', () => {
  it('has correct initial state', () => {
    expect(autoUpdateReducer.initialState).toEqual({
      status: 'idle',
      currentVersion: '',
      updateInfo: null,
      progress: null,
      error: null,
      channel: 'stable',
      toastVisible: false,
      downloadedToastDismissedAt: null,
    });
  });

  it('setUpdateState replaces the wire-owned fields and preserves toast state', () => {
    const state = autoUpdateReducer(
      { ...baseState, toastVisible: true, downloadedToastDismissedAt: 5_000 },
      setUpdateState({
        status: 'downloading',
        currentVersion: '1.0.0',
        updateInfo: { version: '2.0.0', releaseDate: '2026-08-01' },
        progress: { percent: 50, bytesPerSecond: 1024, transferred: 512, total: 1024 },
        error: null,
        channel: 'beta',
      }),
    );
    expect(state.status).toBe('downloading');
    expect(state.updateInfo).toEqual({ version: '2.0.0', releaseDate: '2026-08-01' });
    expect(state.progress).toEqual({
      percent: 50,
      bytesPerSecond: 1024,
      transferred: 512,
      total: 1024,
    });
    expect(state.channel).toBe('beta');
    // Toast visibility and the dismiss cooldown are renderer-owned
    expect(state.toastVisible).toBe(true);
    expect(state.downloadedToastDismissedAt).toBe(5_000);
  });

  it('setProgress updates only the progress field', () => {
    const progress = { percent: 10, bytesPerSecond: 2048, transferred: 100, total: 1000 };
    const state = autoUpdateReducer(baseState, setProgress(progress));
    expect(state).toEqual({ ...baseState, progress });
  });

  it('setUpdateError sets error status and message', () => {
    const state = autoUpdateReducer(baseState, setUpdateError('download failed'));
    expect(state.status).toBe('error');
    expect(state.error).toBe('download failed');
  });

  it('showToast sets toastVisible', () => {
    const state = autoUpdateReducer(baseState, showToast());
    expect(state.toastVisible).toBe(true);
  });

  it('hideToast clears toastVisible without touching the dismiss cooldown', () => {
    const dismissedAt = 1_000;
    const state = autoUpdateReducer(
      { ...baseState, toastVisible: true, downloadedToastDismissedAt: dismissedAt },
      hideToast(),
    );
    expect(state.toastVisible).toBe(false);
    expect(state.downloadedToastDismissedAt).toBe(dismissedAt);
  });

  it('dismissDownloadedToast hides the toast and arms the cooldown timestamp', () => {
    const state = autoUpdateReducer(
      { ...baseState, status: 'downloaded', toastVisible: true },
      dismissDownloadedToast(12_345),
    );
    expect(state.toastVisible).toBe(false);
    expect(state.downloadedToastDismissedAt).toBe(12_345);
  });

  it('showToastChecking shows the toast and sets checking status', () => {
    const state = autoUpdateReducer(baseState, showToastChecking());
    expect(state.toastVisible).toBe(true);
    expect(state.status).toBe('checking');
  });

  // Regression: a manual check must always be able to re-surface the
  // "Update Ready" toast — an armed 24h dismiss cooldown previously caused
  // the re-landed 'downloaded' status to flash-dismiss the toast.
  it('showToastChecking clears the downloaded-toast dismiss cooldown', () => {
    const state = autoUpdateReducer(
      { ...baseState, status: 'downloaded', downloadedToastDismissedAt: Date.now() },
      showToastChecking(),
    );
    expect(state.downloadedToastDismissedAt).toBeNull();
  });

  it('setUpToDate sets not-available and updates the version', () => {
    const state = autoUpdateReducer(baseState, setUpToDate('1.2.3'));
    expect(state.status).toBe('not-available');
    expect(state.currentVersion).toBe('1.2.3');
  });

  it('setUpToDate keeps the current version when the payload is empty', () => {
    const state = autoUpdateReducer(baseState, setUpToDate(''));
    expect(state.status).toBe('not-available');
    expect(state.currentVersion).toBe(baseState.currentVersion);
  });

  it('setCheckTimedOut sets error status while checking', () => {
    const state = autoUpdateReducer({ ...baseState, status: 'checking' }, setCheckTimedOut());
    expect(state.status).toBe('error');
    expect(state.error).toEqual(expect.any(String));
    expect(state.error).not.toBe('');
  });

  it('setCheckTimedOut is a no-op when not checking', () => {
    const before = { ...baseState, status: 'downloaded' as const };
    const state = autoUpdateReducer(before, setCheckTimedOut());
    expect(state).toBe(before);
  });

  it('simulateSetState shallow-merges the partial payload', () => {
    const state = autoUpdateReducer(
      baseState,
      simulateSetState({ status: 'downloaded', downloadedToastDismissedAt: 42 }),
    );
    expect(state).toEqual({
      ...baseState,
      status: 'downloaded',
      downloadedToastDismissedAt: 42,
    });
  });
});
