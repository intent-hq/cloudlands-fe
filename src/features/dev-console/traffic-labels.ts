import * as m from '$shared/paraglide/messages.js';
import type { DevConsoleRow } from '$shared/types/dev-console';
export function statusLabel(status: DevConsoleRow['status']) {
  return {
    pending: m.devConsole_pending_label,
    received: m.devConsole_received_label,
    success: m.devConsole_success_label,
    error: m.devConsole_error_label,
    timeout: m.devConsole_timeout_label,
    disconnected: m.devConsole_disconnected_label,
    'send-error': m.devConsole_sendError_label,
  }[status]();
}

export function trafficTabLabel(tab: import('./traffic-view').TrafficTab) {
  return {
    all: m.devConsole_all_label,
    outbound: m.devConsole_outbound_label,
    inbound: m.devConsole_inbound_label,
    events: m.devConsole_events_label,
  }[tab]();
}
