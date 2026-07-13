/**
 * Mock for bonjour-service module (not installed as a dependency).
 * Used by websocket-discovery.ts for mDNS/Bonjour service discovery.
 */
export class Bonjour {
  publish() {
    return { start: () => {}, stop: () => {} };
  }
  unpublishAll() {}
  destroy() {}
}

