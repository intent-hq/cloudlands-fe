import { describe, expect, it } from 'vitest';
import { INTENT_APPS_OFF_STATE } from '$shared/intent-apps/intent-apps-types';
import { selectIntentAppsLibraryShown } from './intent-apps-selectors';

const withLibrary = (labEnabled: boolean, supported: boolean) =>
  ({
    intentApps: { library: { ...INTENT_APPS_OFF_STATE, labEnabled, supported } },
  }) as never;

describe('selectIntentAppsLibraryShown', () => {
  it('shows the library only with the Labs switch on and intentApps: 1 from the daemon', () => {
    expect(selectIntentAppsLibraryShown.select(withLibrary(true, true))).toBe(true);
    expect(selectIntentAppsLibraryShown.select(withLibrary(true, false))).toBe(false);
    expect(selectIntentAppsLibraryShown.select(withLibrary(false, true))).toBe(false);
  });
});
