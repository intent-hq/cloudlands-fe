/**
 * MCP Servers Store
 *
 * Manages user-defined MCP servers from ~/.augment/settings.json
 * and tracks per-workspace enable/disable state.
 *
 * Servers are ON by default when added.
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

  /** Per-workspace enable state */
  #stateByWorkspace: Record<string, WorkspaceMcpState> = $state({});

  /** Current workspace ID */
  #currentWorkspaceId: string | null = $state(null);

  // Getters
  get servers(): McpServerInfo[] {
    return this.#servers;
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

    try {
      // First check if the feature is enabled
      const settingsResult = await window.electronAPI?.invoke('settings:get', {
        key: 'enableUserMcpServers',
      });
      const featureEnabled = settingsResult?.success && settingsResult.data === true;

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

  /** Persistence: load from workspace metadata via IPC */
  private loadFromStorage(workspaceId: string): void {
    window.electronAPI
      ?.invoke('user-mcp:get-workspace-disabled', { workspaceId })
      .then((result) => {
        if (result?.success && Array.isArray(result.data)) {
          // Convert array of disabled server names to enabledServers map
          const enabledServers: Record<string, boolean> = {};
          for (const name of result.data) {
            enabledServers[name] = false;
          }
          this.#stateByWorkspace[workspaceId] = { enabledServers };
          logger.debug('Loaded MCP server state', {
            workspaceId,
            disabledCount: result.data.length,
          });
        }
      })
      .catch((error) => {
        logger.error('Failed to load MCP server state', { error });
      });
  }
}

export const mcpServersStore = new McpServersStore();
