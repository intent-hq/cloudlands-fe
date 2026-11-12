import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';
import { store } from '$store/renderer/store';
import { selectLabsLocalPairingEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import { initialState } from './local-pairing-slice';
import type { LocalPairingState } from './local-pairing-types';

type VisibilityInput = {
  labsEnabled: boolean;
  desktop: boolean;
  windowBackendId: string | null | undefined;
  support: LocalPairingState['support'];
};

/**
 * @internal Exported for tests; use `selectLocalPairingVisible`.
 *
 * The host side shows only with the Labs switch on, in the desktop app, in a
 * window bound to this computer's own daemon (its events are local-transport
 * only), and when that daemon advertises `localCodePairing: 1` and answers the
 * local-only methods.
 */
export function localPairingVisible(input: VisibilityInput): boolean {
  return (
    input.labsEnabled &&
    input.desktop &&
    input.windowBackendId === LOCAL_CONNECTION_ID &&
    input.support === 'supported'
  );
}

export const selectLocalPairingVisible = store.createSelector((state) =>
  localPairingVisible({
    labsEnabled: selectLabsLocalPairingEnabled.select(state),
    desktop: isElectronPlatform(),
    windowBackendId: state.connections?.windowBackendId,
    support: state.localPairing?.support ?? 'unknown',
  }),
);

export const selectLocalPairing = store.createSelector(
  (state): LocalPairingState => state.localPairing ?? initialState,
);
