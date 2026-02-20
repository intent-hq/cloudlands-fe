/**
 * MCP Settings Store
 *
 * Enhanced store for MCP server management with status tracking,
 * tools, and per-server enable/disable state.
 */

import { createLogger } from '$lib/utils/client-logger';
import type { McpServerConfig, McpServerStatus, McpServerWithStatus, McpTool } from './types';

const logger = createLogger('McpSettingsStore');

class McpSettingsStore {
  // Servers loaded from settings
  #servers = $state<McpServerConfig[]>([]);

  // Server status map (name -> status)
  #statusMap = $state<Record<string, McpServerStatus>>({});

  // Server tools map (name -> tools[])
  #toolsMap = $state<Record<string, McpTool[]>>({});

  // Per-server disabled state (global, not per-workspace)
  #disabledServers = $state<Set<string>>(new Set());

  // Loading/error state
  #loading = $state(false);
  #error = $state<string | null>(null);

  // Feature toggle
  #enabled = $state(false);

  // Getters
  get servers(): McpServerConfig[] {
    return this.#servers;
  }

  get loading(): boolean {
    return this.#loading;
  }

  get error(): string | null {
    return this.#error;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** Get servers with status and tools attached */
  get serversWithStatus(): McpServerWithStatus[] {
    return this.#servers.map((server) => {
      const disabled = this.#disabledServers.has(server.name);
      const tools = this.#toolsMap[server.name] || [];
      let status: McpServerStatus = this.#statusMap[server.name] || 'disconnected';

      if (disabled) {
        status = 'disabled';
      }

      return {
        ...server,
        disabled,
        status,
        tools,
        toolCount: tools.length,
      };
    });
  }

  /** Check if a server is disabled */
  isServerDisabled(name: string): boolean {
    return this.#disabledServers.has(name);
  }

  /** Get tool count for a server */
  getToolCount(name: string): number {
    return this.#toolsMap[name]?.length || 0;
  }

  /** Get status for a server */
  getStatus(name: string): McpServerStatus {
    if (this.#disabledServers.has(name)) return 'disabled';
    return this.#statusMap[name] || 'disconnected';
  }

  /** Toggle feature enabled */
  async setEnabled(enabled: boolean): Promise<void> {
    this.#enabled = enabled;
    try {
      await window.electronAPI?.invoke('settings:set', {
        key: 'enableUserMcpServers',
        value: enabled,
      });
      logger.info('User MCP servers enabled:', enabled);

      if (enabled) {
        await this.loadServers();
      }
    } catch (error) {
      logger.error('Failed to save enabled setting:', error);
    }
  }

  /** Toggle a server's disabled state */
  async toggleServer(name: string): Promise<void> {
    const wasDisabled = this.#disabledServers.has(name);
    const newSet = new Set(this.#disabledServers);

    if (wasDisabled) {
      newSet.delete(name);
    } else {
      newSet.add(name);
    }

    this.#disabledServers = newSet;
    logger.debug('Toggled server:', { name, disabled: !wasDisabled });

    // Persist to settings
    await this.persistDisabledServers();
  }

  /** Set server status (called when connection state changes) */
  setServerStatus(name: string, status: McpServerStatus): void {
    this.#statusMap = { ...this.#statusMap, [name]: status };
  }

  /** Set server tools (called when tools are loaded) */
  setServerTools(name: string, tools: McpTool[]): void {
    this.#toolsMap = { ...this.#toolsMap, [name]: tools };
  }

  /** Load servers from main process */
  async loadServers(): Promise<void> {
    this.#loading = true;
    this.#error = null;

    try {
      // Check if feature is enabled
      const settingsResult = await window.electronAPI?.invoke('settings:get', {
        key: 'enableUserMcpServers',
      });
      this.#enabled = settingsResult?.success && settingsResult.data === true;

      if (!this.#enabled) {
        this.#servers = [];
        logger.debug('User MCP servers feature is disabled');
        return;
      }

      // Load servers - try CLI first, fall back to direct settings.json read
      let result = await window.electronAPI?.invoke('user-mcp:mcp-list', undefined);

      // If CLI-based listing fails, fall back to reading settings.json directly
      if (!result?.success) {
        logger.warn('CLI mcp-list failed, falling back to direct settings read', {
          error: result?.error,
        });
        result = await window.electronAPI?.invoke('user-mcp:get-servers', undefined);
      }

      if (result?.success) {
        const data = result.data;
        let serverList: any[] = [];

        if (Array.isArray(data)) {
          serverList = data;
        } else if (data?.servers && Array.isArray(data.servers)) {
          serverList = data.servers;
        } else if (typeof data === 'object' && data !== null) {
          serverList = Object.entries(data).map(([name, config]: [string, any]) => ({
            name,
            ...config,
          }));
        }

        this.#servers = serverList.map((s: any) => ({
          name: s.name || 'unknown',
          type: s.type || s.transport || (s.command ? 'stdio' : 'http'),
          url: s.url,
          command: s.command,
          args: s.args,
          env: s.env,
          headers: s.headers,
          authType: s.authType,
        }));

        // The CLI `mcp list --json` doesn't include authType in its output.
        // Supplement from a direct settings.json read so authType is preserved.
        const hasAnyAuthType = this.#servers.some((s) => s.authType);
        if (!hasAnyAuthType && this.#servers.length > 0) {
          try {
            const settingsRaw = await window.electronAPI?.invoke(
              'user-mcp:get-servers',
              undefined,
            );
            if (settingsRaw?.success && settingsRaw.data) {
              const rawMap = settingsRaw.data as Record<string, any>;
              for (const server of this.#servers) {
                const raw = rawMap[server.name];
                if (raw?.authType) {
                  server.authType = raw.authType;
                }
              }
            }
          } catch (e) {
            logger.debug('Could not supplement authType from settings.json', e);
          }
        }

        logger.info('Loaded MCP servers:', { count: this.#servers.length });

        // Simulate connected status for now (real status would come from MCP hub)
        for (const server of this.#servers) {
          if (!this.#disabledServers.has(server.name)) {
            this.#statusMap[server.name] = 'connected';
          }
        }
      } else {
        this.#error = result?.error || 'Failed to load servers';
      }
    } catch (error) {
      this.#error = error instanceof Error ? error.message : 'Failed to load servers';
      logger.error('Failed to load MCP servers:', error);
    } finally {
      this.#loading = false;
    }
  }

  /**
   * Check if a URL requires authentication and if we have credentials
   */
  async checkAuthRequirement(url: string): Promise<{
    requiresAuth: boolean;
    hasAuth: boolean;
    providerName?: string;
    providerDisplayName?: string;
    authHint?: string;
  }> {
    try {
      const result = await window.electronAPI?.invoke('user-mcp:check-auth', { url });
      if (result?.success && result.data) {
        return result.data;
      }
    } catch (error) {
      logger.error('Failed to check auth requirement:', error);
    }
    return { requiresAuth: false, hasAuth: false };
  }

  /**
   * Add a new server
   * Returns auth info if the server requires authentication we don't have
   */
  async addServer(config: McpServerConfig): Promise<{
    requiresAuth?: boolean;
    hasAuth?: boolean;
    providerName?: string;
    providerDisplayName?: string;
    authHint?: string;
  } | void> {
    try {
      // Check auth requirements for HTTP/SSE servers
      let authInfo:
        | {
            requiresAuth: boolean;
            hasAuth: boolean;
            providerName?: string;
            providerDisplayName?: string;
            authHint?: string;
          }
        | undefined;

      if (config.type !== 'stdio' && config.url) {
        authInfo = await this.checkAuthRequirement(config.url);
        if (authInfo.requiresAuth && !authInfo.hasAuth) {
          logger.warn('MCP server requires auth but credentials not found:', {
            name: config.name,
            provider: authInfo.providerName,
          });
        }
      }

      const ipcConfig: any = {
        name: config.name,
        transport: config.type,
      };

      if (config.type === 'stdio') {
        ipcConfig.command = config.command;
        if (config.args) ipcConfig.args = config.args.join(' ');
        if (config.env) ipcConfig.env = config.env;
      } else {
        ipcConfig.url = config.url;
        if (config.headers) ipcConfig.headers = config.headers;
        if (config.authType) ipcConfig.authType = config.authType;
      }

      const result = await window.electronAPI?.invoke('user-mcp:mcp-add', ipcConfig);
      if (result?.success) {
        await this.loadServers();
        logger.info('Added MCP server:', config.name);

        // Test connection for HTTP/SSE servers to detect auth requirements
        if (config.type !== 'stdio' && config.url) {
          await this.testServerConnection(config.name, config.url, config.headers);
        }

        // Return auth info if server needs auth we don't have
        if (authInfo?.requiresAuth && !authInfo.hasAuth) {
          return authInfo;
        }
      } else {
        throw new Error(result?.error || 'Failed to add server');
      }
    } catch (error) {
      logger.error('Failed to add MCP server:', error);
      throw error;
    }
  }

  /**
   * Test connection to an HTTP/SSE server and update status
   */
  async testServerConnection(
    name: string,
    url: string,
    headers?: Record<string, string>,
  ): Promise<void> {
    try {
      logger.debug('Testing connection for server:', { name, url });
      // Pass server name for OAuth token lookup
      const result = await window.electronAPI?.invoke('user-mcp:test-connection', {
        url,
        headers,
        name,
      });

      if (result?.success && result.data) {
        const { status, errorMessage } = result.data;
        logger.info('Connection test result:', { name, status, errorMessage });

        // Update the server status based on connection test
        this.setServerStatus(name, status);
      }
    } catch (error) {
      logger.error('Failed to test server connection:', { name, error });
      // Don't throw - connection test failure shouldn't block adding the server
    }
  }

  /** Remove a server */
  async removeServer(name: string): Promise<void> {
    try {
      const result = await window.electronAPI?.invoke('user-mcp:mcp-remove', { name });
      if (result?.success) {
        // Remove from local state
        this.#servers = this.#servers.filter((s) => s.name !== name);
        this.#disabledServers.delete(name);
        delete this.#statusMap[name];
        delete this.#toolsMap[name];
        logger.info('Removed MCP server:', name);
      } else {
        throw new Error(result?.error || 'Failed to remove server');
      }
    } catch (error) {
      logger.error('Failed to remove MCP server:', error);
      throw error;
    }
  }

  /** Update an existing server */
  async updateServer(name: string, config: McpServerConfig): Promise<void> {
    // Remove old and add new
    await this.removeServer(name);
    await this.addServer(config);
  }

  /** Import servers from JSON */
  async importFromJson(jsonString: string): Promise<number> {
    try {
      const data = JSON.parse(jsonString);
      let count = 0;

      // Handle multiple formats:
      // 1. { "mcpServers": { "name": { config } } } - VS Code format
      // 2. { "servers": { "name": { config } } } - alternative wrapper
      // 3. { "name": { config } } - direct format
      let serversObj: Record<string, any> = data;
      if (data.mcpServers && typeof data.mcpServers === 'object') {
        serversObj = data.mcpServers;
      } else if (data.servers && typeof data.servers === 'object') {
        serversObj = data.servers;
      }

      if (typeof serversObj === 'object' && !Array.isArray(serversObj)) {
        for (const [name, config] of Object.entries(serversObj)) {
          const cfg = config as any;

          // Determine transport type based on available fields
          let transportType: 'stdio' | 'http' | 'sse' = 'stdio';
          if (cfg.type === 'http' || cfg.type === 'sse') {
            // Explicit type takes precedence
            transportType = cfg.type;
          } else if (cfg.url) {
            // If URL is present without explicit type, default to http
            transportType = 'http';
          }

          const serverConfig: McpServerConfig = {
            name,
            type: transportType,
            command: cfg.command,
            args: cfg.args,
            env: cfg.env,
            url: cfg.url,
            headers: cfg.headers,
            authType: cfg.authType,
          };
          await this.addServer(serverConfig);
          count++;
        }
      }

      return count;
    } catch (error) {
      logger.error('Failed to import from JSON:', error);
      throw error;
    }
  }

  /** Persist disabled servers to settings */
  private async persistDisabledServers(): Promise<void> {
    // This could be saved to settings if needed
    // For now, we just keep it in memory
  }
}

export const mcpSettingsStore = new McpSettingsStore();
