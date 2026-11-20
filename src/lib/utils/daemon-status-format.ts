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

/** Uptime in seconds as `1h 2m 3s`, `2m 3s` or `3s`; unknown when absent. */
export function formatUptime(seconds: number | undefined): string {
  if (seconds === undefined) return m.layout_daemonStatus_unknown_label();
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}
