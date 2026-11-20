/**
 * Labs: "Browser pages in the main process". The setting lives in main (a
 * local pref read once per run); the renderer only asks to change it. The
 * current values are the `browserViewsLab` store in main-owned-browser-page.
 */
import { createAction } from '@themislib/themis/utils/store/create-action';

/** Save the setting. It applies after a restart. */
export const setBrowserViewsLabRequested = createAction<[enabled: boolean]>(
  'browserViewsLab/setRequested',
);
