/**
 * View model for the workspace "driving client" indicator (REV-2,
 * intent-hq/intent#461). The driving client is the browser-capable client
 * that hosts new agent browser tabs and tunnels for a workspace — the
 * workspace pin when set, else the first eligible connection.
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

export interface DrivingClientInput {
  /** Connected clients advertising `capabilities.browserExec`. */
  eligibleClients: BrowserClientSummary[];
  /** This app's own stable client id. */
  ownClientId: string;
  /** Effective browser client for the workspace; null when none resolves. */
  driving: BrowserClientSummary | null;
}

type DrivingClientMode = 'here' | 'elsewhere' | 'offline';

export interface DrivingClientView {
  mode: DrivingClientMode;
  /** Display name of the driving client (falls back to a shortened id). */
  hostName: string;
  /** Whether "Set Current Client as Primary" applies: another client drives. */
  canSwitchHere: boolean;
}

/** "client-<uuid>" → "client-<first8>…" keeps the id fallback readable. */
function shortenClientId(clientId: string): string {
  return clientId.length > 15 ? `${clientId.slice(0, 15)}…` : clientId;
}

function browserClientDisplayName(client: BrowserClientSummary): string {
  const name = client.name?.trim();
  return name || shortenClientId(client.clientId);
}

/**
 * Resolve what the sidebar should show. Returns null when nothing should be
 * rendered: a single eligible client (this app or nothing) leaves no choice
 * to make, so the indicator stays hidden (spec Model 8). A pinned client that
 * is offline is always surfaced, because agent tabs for the workspace fail
 * until the user switches or the pinned client reconnects.
 */
export function resolveDrivingClientView(input: DrivingClientInput): DrivingClientView | null {
  const { eligibleClients, ownClientId, driving } = input;
  if (!driving) return null;

  const offline = !driving.connected;
  const drivesHere = driving.clientId === ownClientId;
  const switchPossible = eligibleClients.length >= 2;
  if (!offline && !switchPossible) return null;

  const mode: DrivingClientMode = offline ? 'offline' : drivesHere ? 'here' : 'elsewhere';
  return {
    mode,
    hostName: browserClientDisplayName(driving),
    canSwitchHere: !drivesHere,
  };
}
