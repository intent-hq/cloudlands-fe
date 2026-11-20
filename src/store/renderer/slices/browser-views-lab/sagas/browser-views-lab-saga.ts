/**
 * Reads the "Browser pages in the main process" Labs setting at app start
 * (each window picks its browser page path once) and saves changes.
 */
import { call, takeEvery } from 'typed-redux-saga';
import {
  loadBrowserViewsLab,
  setBrowserViewsLabEnabled,
} from '$lib/components/browser/main-owned-browser-page';
import { setBrowserViewsLabRequested } from '../browser-views-lab-slice';

export function* browserViewsLabSaga() {
  yield* call(loadBrowserViewsLab);
  yield* takeEvery(setBrowserViewsLabRequested, function* ({ payload: [enabled] }) {
    yield* call(setBrowserViewsLabEnabled, enabled);
  });
}
