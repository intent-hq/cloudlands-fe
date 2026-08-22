import { describe, expect, it } from 'vitest';
import type { AutoUpdateState } from './auto-update-types';
import {
  autoUpdateReducer,
  dismissDownloadedToast,
  hideToast,
  showToast,
  showToastChecking,
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
});
