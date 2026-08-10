/**
 * Console-owner gate for the hardware input services
 * (intent-hq/monorepo#1928): only the owner window — the last-focused
 * non-HUD window, tracked by main and mirrored into the hardware-console
 * slice — acts on decoded hardware input. Non-owner windows keep their
 * device wiring attached (the stream stays subscribed) but ignore events,
 * so an ownership flip re-enables handling instantly without re-plugging.
 *
 * Dependency-light per the device-service conventions: no selector
 * imports — reads `appStore.state` directly.
 */
import { store as appStore } from '$store/renderer/store';

/** Whether this window currently owns the hardware console. */
export function isConsoleOwner(): boolean {
  return appStore.state.hardwareConsole.isConsoleOwner;
}
