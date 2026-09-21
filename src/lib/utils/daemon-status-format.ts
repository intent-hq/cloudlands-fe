/**
 * Formatting helpers for the Daemon Status popover.
 */

import { m } from '$shared/paraglide/messages.js';

/**
 * Display label for the FE connection mode row, as a single string so the
 * value can truncate with the full text exposed via `title` (#1744). A remote
 * connection that won through the tailcat tunnel renders its target through
 * the localized "via tailcat" message.
 */
export function formatTransportLabel(transport: {
  mode: 'sidecar-uds' | 'external-uds' | 'external-ws';
  target?: string;
  connectedVia?: 'direct' | 'tunnel';
}): string {
  if (transport.mode === 'sidecar-uds') {
    // i18n-ignore (transport mode identifier, not translatable UI copy)
    return 'sidecar (UDS)';
  }
  if (transport.target) {
    const target =
      transport.connectedVia === 'tunnel'
        ? m.layout_daemonStatus_connectionViaTailcat_label({ target: transport.target })
        : transport.target;
    // i18n-ignore (transport mode identifier, not translatable UI copy)
    return `external (${target})`;
  }
  // i18n-ignore (transport mode identifier, not translatable UI copy)
  return 'external (WebSocket)';
}
