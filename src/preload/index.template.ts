/**
 * Preload Script
 *
 * Clean, secure bridge between renderer and main process.
 * Uses contextBridge for security.
 *
 * ⚠️  src/preload/index.ts is GENERATED from src/preload/index.template.ts by
 *     scripts/inline-ipc-channels.ts, which runs on every 'npm run dev' and
 *     every 'npm run build'. Edit the TEMPLATE. Anything written directly into
 *     index.ts is overwritten at build time and never reaches a packaged app.
 *
 *     index.ts is NOT tracked in git (see .gitignore): after a fresh clone or
 *     install, create it with 'pnpm run generate:ipc-channels'; dev and build
 *     regenerate it themselves.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';

// ALLOWED_CHANNELS, DYNAMIC_CHANNEL_PATTERNS, EVENT_CHANNELS and
// isChannelAllowed() are generated from src/shared/ipc-registry.ts and inserted
// at the marker below. Add or remove channels in the registry, never here:
// scripts/inline-ipc-channels.ts refuses to run if this template carries its
// own copy of the channel lists.
// GENERATED_CHANNELS_PLACEHOLDER

// Note: Preload scripts run in a special context and cannot import from shared modules
// Console statements here are acceptable as they're for debugging the preload bridge

// Simple logger for preload context - can't import external modules
const logger = {
  info: (...args: any[]): void => console.log('[Preload]', ...args),
  warn: (...args: any[]): void => console.warn('[Preload]', ...args),
  error: (...args: any[]): void => console.error('[Preload]', ...args),
  debug: (...args: any[]): void => console.log('[Preload:Debug]', ...args),
};

// Track IPC listener wrappers for proper cleanup.
//
// IMPORTANT: under Electron context isolation, function identity across the bridge
// is unreliable. Prefer ID-based cleanup via offById().
type ListenerEntry = {
  id: string;
  original: (...args: any[]) => void;
  wrapped: (...args: any[]) => void;
};

// Maps channel -> listenerId -> { original callback reference, wrapped callback }
const listenerRegistry = new Map<string, Map<string, ListenerEntry>>();

let listenerIdCounter = 0;
function generateListenerId(): string {
  listenerIdCounter += 1;
  // Counter prevents collisions within the same millisecond.
  return `l${Date.now()}_${listenerIdCounter}`;
}

// Define the API exposed to the renderer
const electronAPI = {
  // Decoder capability only: the renderer and main must independently opt in.
  reviewMonitoring: 1,
  // IPC invoke (request/response)
  invoke: (channel: string, ...args: any[]) => {
    // Use generated allowed channels for security
    if (isChannelAllowed(channel)) {
      // Pass args as-is to respect union schemas and other complex types
      // The validation middleware will handle type checking
      return ipcRenderer.invoke(channel, ...args).catch((err) => {
        logger.error(`[Preload] IPC invoke failed for ${channel}:`, err);
        throw err;
      });
    } else {
      const err = new Error(`Unauthorized channel: ${channel}`);
      logger.warn(`[Preload] Blocked IPC invoke on unauthorized channel: ${channel}`);
      return Promise.reject(err);
    }
  },

  // IPC send (one-way)
  send: (channel: string, ...args: any[]) => {
    // Use generated allowed channels for security
    if (isChannelAllowed(channel)) {
      ipcRenderer.send(channel, ...args);
    } else {
      logger.warn(`[Preload] Blocked IPC send on unauthorized channel: ${channel}`);
    }
  },

  // IPC on (listen for events from main)
  // Returns a unique listener ID for reliable cleanup with offById()
  on: (channel: string, callback: (...args: any[]) => void): string => {
    // Increase max listeners for dynamic channels (e.g., agent:stream:uuid)
    // These channels are commonly used and shouldn't trigger memory warnings
    const dynamicPrefixes = ['agent:stream:', 'terminal:'];
    const isDynamicChannel = dynamicPrefixes.some((prefix) => channel.startsWith(prefix));
    if (isDynamicChannel) {
      ipcRenderer.setMaxListeners(50); // Higher limit for dynamic channels
    }

    // Use generated allowed channels (includes dynamic patterns)
    if (isChannelAllowed(channel)) {
      // Create a wrapper function that matches the IPC renderer signature
      const wrappedCallback = (_event: Electron.IpcRendererEvent, ...args: any[]) => {
        try {
          // Ensure we have at least one argument, even if it's undefined
          // This prevents errors when handlers expect data but receive nothing
          if (args.length === 0) {
            callback({});
          } else if (args.length === 1) {
            // For single argument, pass it directly (most common case)
            callback(args[0]);
          } else {
            // For multiple arguments, pass them all
            callback(...args);
          }
        } catch (error) {
          logger.error(`[Preload] Error in event handler for ${channel}:`, error);
        }
      };

      const listenerId = generateListenerId();

      // Register the callback mapping for later removal
      let channelListeners = listenerRegistry.get(channel);
      if (!channelListeners) {
        channelListeners = new Map();
        listenerRegistry.set(channel, channelListeners);
      }
      channelListeners.set(listenerId, {
        id: listenerId,
        original: callback,
        wrapped: wrappedCallback,
      });

      // Attach wrapper reference to original callback for external access
      // This allows callers to retrieve the wrapped function via (callback as any).__ipcWrapper
      (callback as any).__ipcWrapper = wrappedCallback;
      (callback as any).__ipcListenerId = listenerId;

      ipcRenderer.on(channel, wrappedCallback);

      return listenerId;
    } else {
      logger.warn(`[Preload] Blocked IPC listener on unauthorized channel: ${channel}`);
      return '';
    }
  },

  // IPC off (remove listener)
  off: (channel: string, callback: (...args: any[]) => void) => {
    // Look up the wrapped callback from the registry
    const channelListeners = listenerRegistry.get(channel);
    if (channelListeners) {
      for (const [listenerId, entry] of channelListeners.entries()) {
        if (entry.original === callback) {
          ipcRenderer.removeListener(channel, entry.wrapped);
          channelListeners.delete(listenerId);
          // Clean up empty maps
          if (channelListeners.size === 0) {
            listenerRegistry.delete(channel);
          }
          return;
        }
      }
    }
    // Fallback: try removing with the original callback directly
    // (in case it was registered outside this API)
    logger.warn(
      `[Preload] Listener registry miss for channel ${channel} - callback not found in registry. This may indicate a listener leak.`,
    );
    ipcRenderer.removeListener(channel, callback);
  },

  // Remove listener by ID - reliable with Electron's context isolation
  offById: (channel: string, listenerId: string) => {
    if (!listenerId) return;

    if (!isChannelAllowed(channel)) {
      logger.warn(`[Preload] Blocked offById on unauthorized channel: ${channel}`);
      return;
    }

    const channelListeners = listenerRegistry.get(channel);
    const entry = channelListeners?.get(listenerId);
    if (channelListeners && entry) {
      ipcRenderer.removeListener(channel, entry.wrapped);
      channelListeners.delete(listenerId);
      if (channelListeners.size === 0) {
        listenerRegistry.delete(channel);
      }
      return;
    }

    // Listener not found - this is normal if removeAllListeners() was called first
    // (e.g., renderer stream lifecycle cleans up stream channels with removeAllListeners,
    // then component cleanup calls offById). No warning needed.
  },

  // Remove all listeners for a channel
  removeAllListeners: (channel: string) => {
    if (isChannelAllowed(channel)) {
      ipcRenderer.removeAllListeners(channel);
      // Also clean up our registry
      listenerRegistry.delete(channel);
    } else {
      logger.warn(`[Preload] Blocked removeAllListeners on unauthorized channel: ${channel}`);
    }
  },

  // Diagnostics: current listener registrations per channel.
  //
  // The renderer cannot see ipcRenderer's own emitter, so this is the only
  // truthful source for "how many subscriptions are live" — used by the
  // renderer retention fingerprint to spot accumulation (e.g. the
  // backend:notification pile-up) without a heap snapshot. Channels with no
  // listeners are omitted; once() listeners are not tracked by the registry
  // and so are not counted. Read-only: returns a plain snapshot object.
  getIpcListenerCounts: (): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const [channel, entries] of listenerRegistry) {
      if (entries.size > 0) counts[channel] = entries.size;
    }
    return counts;
  },

  // IPC once (listen once)
  once: (channel: string, callback: (...args: any[]) => void) => {
    // Use generated allowed channels for security
    if (isChannelAllowed(channel)) {
      ipcRenderer.once(channel, (_event, ...args) => callback(...args));
    } else {
      logger.warn(`[Preload] Blocked IPC once on unauthorized channel: ${channel}`);
    }
  },

  // File utilities - get filesystem path for dropped/selected files
  // Uses Electron's webUtils.getPathForFile which works with contextIsolation
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  // Platform info
  platform: process.platform,
  arch: process.arch,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type definitions for TypeScript
export type ElectronAPI = typeof electronAPI;

// Add type augmentation for window
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
