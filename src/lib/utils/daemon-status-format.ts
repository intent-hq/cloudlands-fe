/**
 * Formatting helpers for the Daemon Status popover.
 */

/**
 * Display label for the FE connection mode row, as a single string so the
 * value can truncate with the full text exposed via `title` (#1744).
 */
export function formatTransportLabel(transport: {
  mode: 'sidecar-uds' | 'external-uds' | 'external-ws';
  target?: string;
}): string {
  if (transport.mode === 'sidecar-uds') {
    // i18n-ignore (transport mode identifier, not translatable UI copy)
    return 'sidecar (UDS)';
  }
  if (transport.target) {
    // i18n-ignore (transport mode identifier, not translatable UI copy)
    return `external (${transport.target})`;
  }
  // i18n-ignore (transport mode identifier, not translatable UI copy)
  return 'external (WebSocket)';
}
