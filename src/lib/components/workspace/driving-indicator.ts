/**
 * View model for the workspace "driving client" indicator (REV-2,
 * intent-hq/intent#461). The driving client is the browser-capable client
 * that hosts a workspace's agent browser tabs and tunnels — the workspace
 * pin when set, else the first eligible connection; re-pinning migrates the
 * workspace's claimed tabs to the new pin.
 *
 * Presentational only: callers pass the eligible clients and the resolved
 * driving client; nothing here talks to the daemon.
 */

/** A browser-capable client as reported by the daemon (`client.list`). */
export interface BrowserClientSummary {
  clientId: string;
  /** Display name from `client.hello`; absent for clients that sent none. */
  name?: string;
  /** Whether the client currently has a live connection. */
  connected: boolean;
}

/** The workspace's resolved browser clients, as the daemon reports them. */
export interface ResolvedBrowserClients {
  /** Connected clients advertising `capabilities.browserExec`. */
  eligibleClients: BrowserClientSummary[];
  /** This app's own stable client id. */
  ownClientId: string;
  /** Effective browser client for the workspace; null when none resolves. */
  driving: BrowserClientSummary | null;
  /** Explicit workspace pin; a resolved default is not an explicit selection. */
  pinnedClientId?: string | null;
}

export interface DrivingClientInput extends ResolvedBrowserClients {
  /** Whether the workspace has an agent-owned browser tab, visible or hidden. */
  hasBrowserTabs: boolean;
  /** Actual computer from an active desktop session, never a fallback name. */
  activeComputerName?: string;
}

type DrivingClientMode = 'here' | 'elsewhere' | 'offline';

export interface DrivingClientView {
  mode: DrivingClientMode;
  /** Display name of the driving client (falls back to a shortened id). */
  hostName: string;
  /** Whether this connected client can become an explicit workspace selection. */
  canSwitchHere: boolean;
}

/** "client-<uuid>" → "client-<first8>…" keeps the id fallback readable. */
function shortenClientId(clientId: string): string {
  return clientId.length > 15 ? `${clientId.slice(0, 15)}…` : clientId;
}

export function browserClientDisplayName(client: BrowserClientSummary): string {
  const name = client.name?.trim();
  return name || shortenClientId(client.clientId);
}

/** Menu availability is independent of activity and the number of clients. */
export function resolveDrivingClientSwitch(clients: ResolvedBrowserClients): DrivingClientView {
  const { eligibleClients, ownClientId, driving, pinnedClientId } = clients;
  const own = eligibleClients.find((client) => client.clientId === ownClientId && client.connected);
  const offline = driving !== null && !driving.connected;
  const drivesHere = !driving || driving.clientId === ownClientId;
  return {
    mode: offline ? 'offline' : drivesHere ? 'here' : 'elsewhere',
    hostName: driving
      ? browserClientDisplayName(driving)
      : own
        ? browserClientDisplayName(own)
        : '',
    canSwitchHere: Boolean(own && pinnedClientId !== ownClientId),
  };
}

/** Offline pins offer recovery; agent activity shows its computer even with one client. */
export function resolveDrivingClientView(input: DrivingClientInput): DrivingClientView | null {
  if (!input.activeComputerName && !input.hasBrowserTabs && input.driving?.connected !== false)
    return null;
  if (!input.activeComputerName && !input.driving) return null;
  const view = resolveDrivingClientSwitch(input);
  if (input.activeComputerName) {
    return {
      ...view,
      mode: view.mode === 'offline' ? 'elsewhere' : view.mode,
      hostName: input.activeComputerName,
    };
  }
  return view;
}
