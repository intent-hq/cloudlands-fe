/**
 * Shared shape + predicate used by the MCP stdio proxy to distinguish a real
 * HTTP MCP bridge from an unrelated service that happens to answer
 * `GET /health` on a probed port (e.g. the SvelteKit dev server or the
 * intentd WebSocket listener, both of which live near the 5179–5188 bridge
 * scan range).
 */

export interface BridgeHealthInfo {
  status?: string;
  service?: string;
  bridgeApiVersion?: number;
  port?: number;
  pid?: number;
  appPath?: string;
  processCwd?: string;
  isPackaged?: boolean;
}

/**
 * A `/health` 200 only counts as a bridge candidate when the JSON payload
 * self-identifies as the HTTP MCP bridge: either `service === "http-mcp-bridge"`
 * or a numeric `bridgeApiVersion`. Anything else (Vite dev server 404 fallback,
 * intentd `{status:"ok",clients:N}`, a random health endpoint) is skipped.
 */
export function isRealBridgeHealth(health: BridgeHealthInfo | null | undefined): boolean {
  if (!health || typeof health !== 'object') return false;
  if (health.service === 'http-mcp-bridge') return true;
  if (typeof health.bridgeApiVersion === 'number' && Number.isFinite(health.bridgeApiVersion)) {
    return true;
  }
  return false;
}
