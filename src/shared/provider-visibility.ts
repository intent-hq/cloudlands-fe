/** Provider id of the Labs-gated Cursor provider. */
export const CURSOR_PROVIDER_ID = 'cursor';

/** Per-device entry-point gates that decide whether an unenabled provider is offered. */
export interface ProviderListingGates {
  /** Labs > Cursor (`labsCursorProviderEnabled`) on this device. */
  cursorLabEnabled?: boolean;
}

/**
 * Whether a provider is offered in provider lists.
 *
 * An enabled provider is always listed so it keeps its disable control: a Labs
 * gate is an entry point only and never hides or disables an enabled provider.
 * Otherwise Auggie is offered only to existing installations, and Cursor only
 * while its Labs switch is on.
 */
export function isProviderListed(
  providerId: string | undefined,
  installed: boolean | undefined,
  enabled = false,
  gates: ProviderListingGates = {},
): boolean {
  if (enabled) return true;
  if (providerId === 'auggie') return installed === true;
  if (providerId === CURSOR_PROVIDER_ID) return gates.cursorLabEnabled === true;
  return true;
}
