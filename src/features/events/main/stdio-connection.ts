/**
 * Global STDIO connection for MCP event broadcasting.
 * Moved from unified-event-bus.ts during Redux migration cleanup.
 */

let stdioConnection: NodeJS.WriteStream | null = null;

export function setStdioConnection(stream: NodeJS.WriteStream | null) {
  stdioConnection = stream;
}

export function getStdioConnection(): NodeJS.WriteStream | null {
  return stdioConnection;
}

