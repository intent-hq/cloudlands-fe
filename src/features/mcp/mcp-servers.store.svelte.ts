/**
 * MCP Servers Store
 *
 * Manages user-defined MCP servers from ~/.augment/settings.json
 * and tracks per-workspace enable/disable state.
 *
 * New workspaces inherit the global disabled state from Settings → Workspace Setup
 * so that servers disabled globally start disabled in new spaces.
 * Once a workspace has its own persisted state, that takes precedence.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('McpServersStore');

/**
 * MCP Server configuration type (renderer-side mirror of main process types)
 */
export interface McpServerInfo {
  name: string;
  type: 'http' | 'sse' | 'command';
  url?: string;
  command?: string;
  error?: string;
}

/**
 * Per-workspace MCP server enable state
 */
interface WorkspaceMcpState {
  /** Map of server name -> enabled state (defaults to true) */
  enabledServers: Record<string, boolean>;
}

class McpServersStore {
  /** Servers loaded from ~/.augment/settings.json */
  #servers = $state<McpServerInfo[]>([]);

  /** Loading state */
  #loading = $state(false);

  /** Error message if any */
  #error = $state<string | null>(null);

  /** Per-server startup error messages */
  #serverErrors = $state<Record<string, string>>({});

  /** Per-workspace enable state */
  #stateByWorkspace: Record<string, WorkspaceMcpState> = $state({});

  /** Current workspace ID */
  #currentWorkspaceId: string | null = $state(null);

  /** Whether we've set up the IPC listener */
  #listenerInitialized = false;

  constructor() {
    this.initErrorListener();
  }

  /** Set up listener for MCP server error events from main process */
  private initErrorListener(): void {
    if (this.#listenerInitialized) return;
    this.#listenerInitialized = true;

    try {
      window.electronAPI?.on('mcp:server-error', (_event: any, data: any) => {
        const { serverName, command, errorMessage } = data || {};
        if (!errorMessage) return;

        // Make error messages more user-friendly
        const isAuthError = /\bUnauthorized\b|\b401\b|\b403\b|\bauth/i.test(errorMessage);
        const friendlyMessage = isAuthError
          ? 'Authentication required — check your credentials or reauthenticate'
          : errorMessage;

        // If we have a server name, use it directly
        if (serverName) {
          this.#serverErrors = { ...this.#serverErrors, [serverName]: friendlyMessage };
          logger.warn('MCP server error received', { serverName, errorMessage });
          return;
        }

        // Try to match by command/URL against our loaded servers
        if (command) {
          for (const server of this.#servers) {
            if (
              (server.url && command.includes(server.url)) ||
              (server.command && command.includes(server.command))
            ) {
              this.#serverErrors = { ...this.#serverErrors, [server.name]: friendlyMessage };
              logger.warn('MCP server error matched by command', {
                serverName: server.name,
                errorMessage,
              });
              return;
            }
          }
        }

        logger.warn('MCP server error received but could not match to server', {
          command,
          errorMessage,
        });
      });
    } catch {
      // electronAPI may not be available in all contexts
    }
  }

  // Getters
  get servers(): McpServerInfo[] {
    return this.#servers;
  }

  /** Get per-server errors */
  get serverErrors(): Record<string, string> {
    return this.#serverErrors;
  }

  get loading(): boolean {
    return this.#loading;
  }

  get error(): string | null {
    return this.#error;
  }

  get currentWorkspaceId(): string | null {
    return this.#currentWorkspaceId;
  }

  /** Get enabled servers for the current workspace */
  get enabledServers(): McpServerInfo[] {
    if (!this.#currentWorkspaceId) return [];
    const state = this.#stateByWorkspace[this.#currentWorkspaceId];
    return this.#servers.filter((server) =>
      // Default to enabled if not explicitly disabled
      state?.enabledServers[server.name] !== false,
    );
  }

  /** Get disabled server names for the current workspace */
  get disabledServerNames(): string[] {
    if (!this.#currentWorkspaceId) return [];
    const state = this.#stateByWorkspace[this.#currentWorkspaceId];
    if (!state) return [];
    return Object.entries(state.enabledServers)
      .filter(([, enabled]) => enabled === false)
      .map(([name]) => name);
  }

  /** Get error message for a specific server */
  getServerError(serverName: string): string | undefined {
    return this.#serverErrors[serverName];
  }

  /** Check if a specific server is enabled */
  isServerEnabled(serverName: string): boolean {
    if (!this.#currentWorkspaceId) return true;
    const state = this.#stateByWorkspace[this.#currentWorkspaceId];
    // Default to enabled (true) if not explicitly set
    return state?.enabledServers[serverName] !== false;
  }

  /** Set workspace and load state from storage */
  setWorkspace(workspaceId: string): void {
    this.#currentWorkspaceId = workspaceId;
    if (!this.#stateByWorkspace[workspaceId]) {
      this.#stateByWorkspace[workspaceId] = {
        enabledServers: {},
      };
      this.loadFromStorage(workspaceId);
    }
  }

  /** Toggle a server's enabled state */
  toggleServer(serverName: string, enabled?: boolean): void {
    if (!this.#currentWorkspaceId) return;

    const workspaceId = this.#currentWorkspaceId;
    if (!this.#stateByWorkspace[workspaceId]) {
      this.#stateByWorkspace[workspaceId] = { enabledServers: {} };
    }

    const newEnabled = enabled ?? !this.isServerEnabled(serverName);
    // Create new object to trigger reactivity
    this.#stateByWorkspace[workspaceId] = {
      ...this.#stateByWorkspace[workspaceId],
      enabledServers: {
        ...this.#stateByWorkspace[workspaceId].enabledServers,
        [serverName]: newEnabled,
      },
    };

    this.saveToStorage(workspaceId);
    logger.debug('Toggled MCP server', { serverName, enabled: newEnabled, workspaceId });
  }

  /** Load servers from the main process */
  async loadServers(): Promise<void> {
    this.#loading = true;
    this.#error = null;
    // Clear previous errors on reload — new errors will arrive via IPC if servers still fail
    this.#serverErrors = {};

    try {
      // First check if the feature is enabled
      const settingsResult = await window.electronAPI?.invoke('settings:get', {
        key: 'enableUserMcpServers',
      });
      const featureEnabled = settingsResult?.success ? settingsResult.data !== false : true;

      if (!featureEnabled) {
        // Feature is disabled, don't show any servers
        this.#servers = [];
        logger.debug('User MCP servers feature is disabled');
        return;
      }

      const result = await window.electronAPI?.invoke('user-mcp:get-servers', undefined);
      if (result?.success && result.data) {
        const serverMap = result.data as Record<string, any>;
        this.#servers = Object.entries(serverMap).map(([name, config]) => {
          const cfg = config as any;
          return {
            name,
            type: cfg.type === 'http' ? 'http' : cfg.type === 'sse' ? 'sse' : 'command',
            url: cfg.url,
            command: cfg.command,
          } as McpServerInfo;
        });
        logger.info('Loaded MCP servers', { count: this.#servers.length });
      } else {
        this.#servers = [];
        logger.debug('No MCP servers found in settings');
      }
    } catch (error) {
      this.#error = error instanceof Error ? error.message : 'Failed to load MCP servers';
      logger.error('Failed to load MCP servers', { error });
    } finally {
      this.#loading = false;
    }
  }

  /** Persistence: save to workspace metadata via IPC */
  private saveToStorage(workspaceId: string): void {
    const state = this.#stateByWorkspace[workspaceId];
    if (!state) return;

    // Get list of disabled server names
    const disabledServers = Object.entries(state.enabledServers)
      .filter(([, enabled]) => enabled === false)
      .map(([name]) => name);

    // Save via IPC to workspace metadata directory
    window.electronAPI
      ?.invoke('user-mcp:set-workspace-disabled', { workspaceId, disabledServers })
      .then((result) => {
        if (!result?.success) {
          logger.error('Failed to save MCP server state', { error: result?.error });
        }
      })
      .catch((error) => {
        logger.error('Failed to save MCP server state', { error });
      });
  }

  /**
   * Apply a disabled server list to the workspace state.
   * Creates a new top-level object to ensure Svelte 5 $state reactivity fires.
   */
  private applyDisabledServers(workspaceId: string, disabledNames: string[]): void {
    const enabledServers: Record<string, boolean> = {};
    for (const name of disabledNames) {
      enabledServers[name] = false;
    }
    // Reassign the entire object — mutating a nested property on the $state proxy
    // inside an async callback doesn't reliably trigger Svelte 5 reactivity.
    this.#stateByWorkspace = {
      ...this.#stateByWorkspace,
      [workspaceId]: { enabledServers },
    };
  }

  /** Persistence: load from workspace metadata via IPC */
  private loadFromStorage(workspaceId: string): void {
    window.electronAPI
      ?.invoke('user-mcp:get-workspace-disabled', { workspaceId })
      ?.then((result) => {
        if (result?.success && Array.isArray(result.data)) {
          // Workspace has an explicit persisted disabled list (may be empty → "all enabled")
          this.applyDisabledServers(workspaceId, result.data);
          logger.debug('Loaded MCP server state from workspace', {
            workspaceId,
            disabledCount: result.data.length,
          });
        } else if (result?.success && result.data === null) {
          // No workspace-specific state — inherit from global disabled servers.
          // Note: inherited defaults are intentionally NOT persisted. This means
          // spaces that never had their MCP toggles touched will keep reflecting
          // the latest global state on each load, which is the expected UX —
          // once a user explicitly toggles a server in a space, that action
          // persists and the space becomes independent.
          this.loadGlobalDefaults(workspaceId);
        }
      })
      ?.catch((error: unknown) => {
        logger.error('Failed to load MCP server state', { error });
      });
  }

  /**
   * Load the global disabled servers from Settings → Workspace Setup
   * and apply them as the initial per-workspace defaults.
   * This ensures new spaces reflect the global disabled state.
   */
  private loadGlobalDefaults(workspaceId: string): void {
    window.electronAPI
      ?.invoke('settings:get', { key: 'disabledMcpServers' })
      ?.then((result) => {
        if (result?.success && Array.isArray(result.data) && result.data.length > 0) {
          // Filter non-string entries for consistency with getGlobalDisabledMcpServers
          const filtered = result.data.filter((item: unknown): item is string => typeof item === 'string');
          this.applyDisabledServers(workspaceId, filtered);
          logger.debug('Inherited global disabled MCP servers for new workspace', {
            workspaceId,
            disabledCount: result.data.length,
            disabledServers: result.data,
          });
        }
      })
      ?.catch((error: unknown) => {
        logger.error('Failed to load global MCP server defaults', { error });
      });
  }
}

export const mcpServersStore = new McpServersStore();
