// Test-only stub for the `ws` package.
// Vitest resolves the browser export of ws (due to 'browser' in resolve.conditions),
// which doesn't provide createWebSocketStream. This stub satisfies the import.

class WebSocket {
  close() {}
  send() {}
  addEventListener() {}
  removeEventListener() {}
}

export function createWebSocketStream() {
  throw new Error('createWebSocketStream is not available in tests');
}

export default WebSocket;

