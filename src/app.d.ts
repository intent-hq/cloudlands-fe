// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces

// Extend Svelte HTML types with standard attributes not yet in the typings
declare module 'svelte/elements' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLAttributes<T> {
    autocorrect?: 'on' | 'off' | string;
  }
}

declare global {
  namespace App {}

  const __DEV_GIT_BRANCH__: string;

  interface Window {
    intent?: {
      reduxContext?:
        | import('./lib/store/types').ReduxStoreContext
        | import('./lib/store/types').ReduxStoreContext[];
      enableReduxLogging?: () => void;
      disableReduxLogging?: () => void;
      debug?: {
        toggleReduxLogs?: () => void;
        toggleStateReferenceChecks?: () => void;
        toggleStructuredCloneChecks?: () => void;
      };
    };
    isStorybook?: boolean;
    electronAPI: {
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
      on: (channel: string, callback: (...args: any[]) => void) => string;
      // DEPRECATED: Use offById() instead - off() doesn't work reliably with context isolation
      off: (channel: string, callback: (...args: any[]) => void) => void;
      // Remove listener by ID - reliable with Electron's context isolation
      offById: (channel: string, listenerId: string) => void;
      once: (channel: string, callback: (...args: any[]) => void) => void;
      removeAllListeners: (channel: string) => void;
      // Optional structured log sender used by ClientLogger
      sendLog?: (log: {
        level: 'debug' | 'info' | 'warn' | 'error';
        name: string;
        message: string;
        data?: any;
        timestamp: string;
      }) => void;
      platform: string;
      arch: string;
      versions: {
        node: string;
        chrome: string;
        electron: string;
      };
      // Dev instance info - for running multiple concurrent dev servers
      devInstance: string | null;
      devPort: string | null;
    };
  }
}

export {};
