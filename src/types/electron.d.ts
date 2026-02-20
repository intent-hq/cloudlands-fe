/**
 * Electron API type declarations
 */

interface ElectronAPI {
  // Sentry config exposed from preload (DSN not bundled into client JS)
  getSentryConfig?: () => {
    dsn: string | undefined;
    environment: string;
    release: string | undefined;
  } | null;
  // Async version that fetches config from main process via IPC
  fetchSentryConfig?: () => Promise<{
    dsn?: string;
    environment?: string;
    release?: string;
  } | null>;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  send: (channel: string, ...args: any[]) => void;
  // Returns a unique listener ID for use with offById()
  on: (channel: string, handler: (...args: any[]) => void) => string;
  // DEPRECATED: Use offById() instead - off() doesn't work reliably with context isolation
  off: (channel: string, handler: (...args: any[]) => void) => void;
  // Remove listener by ID - reliable with Electron's context isolation
  offById: (channel: string, listenerId: string) => void;
  emit?: (channel: string, ...args: any[]) => void;
  removeAllListeners: (channel: string) => void;
  // Dev instance info - for running multiple concurrent dev servers
  devInstance: string | null;
  devPort: string | null;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
