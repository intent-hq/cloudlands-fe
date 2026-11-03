import * as m from '$shared/paraglide/messages.js';
import {
  LINK_TRAFFIC_FORBIDDEN,
  type LinkPeerKind,
  type LinkTrafficRow,
} from '$shared/types/daemon-links';
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

export function linkDirectionLabel(direction: LinkTrafficRow['direction']) {
  return direction === 'out'
    ? m.devConsole_links_sent_label()
    : m.devConsole_links_received_label();
}

export function linkPeerKindLabel(kind: LinkPeerKind) {
  return kind === 'machine' ? m.devConsole_links_machine_label() : m.devConsole_backend_label();
}

/** Daemon-link errors cross IPC as messages; the owner-only refusal carries a fixed marker. */
export function linkErrorLabel(error: string) {
  return error.includes(LINK_TRAFFIC_FORBIDDEN) ? m.devConsole_links_ownerOnly_error() : error;
}
