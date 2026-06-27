import { EventEmitter } from '../event-emitter';
import { Logger } from '../logger';

export interface AppConfig {
  appearance: {
    theme: 'light' | 'dark' | 'system';
    fontSize: number;
    fontFamily: string;
  };
  editor: {
    tabSize: number;
    wordWrap: boolean;
    lineNumbers: boolean;
    minimap: boolean;
  };
  ai: {
    apiUrl: string;
    apiToken: string;
    model: string;
    temperature: number;
    maxTokens: number;
    streamingSpeed: number;
  };
  workspace: {
    defaultPath: string;
    autoSave: boolean;
    autoSaveInterval: number;
    recentWorkspaces: string[];
    maxRecentWorkspaces: number;
  };
  shortcuts: {
    [key: string]: string;
  };
  experimental: {
    enableBetaFeatures: boolean;
    debugMode: boolean;
  };
  permissions?: {
    rules?: Array<{
      pattern: string;
      action: 'allow' | 'deny' | 'ask';
      scope?: 'session' | 'agent' | 'global';
      expiresAt?: number;
    }>;
  };
  userRules?: {
    enabled: boolean;
    rules: Array<{
      id: string;
      name: string;
      content: string;
      enabled: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  workspaceRules?: {
    enabled: boolean;
    content: string;
    updatedAt: string;
  };
}

const DEFAULT_CONFIG: AppConfig = {
  appearance: {
    theme: 'dark',
    fontSize: 14,
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  editor: {
    tabSize: 2,
    wordWrap: true,
    lineNumbers: true,
    minimap: false,
  },
  ai: {
    apiUrl: 'https://api.augmentcode.com',
    apiToken: '',
    model: 'opus4.5', // Short model ID format
    temperature: 0.7,
    maxTokens: 4096,
    streamingSpeed: 15,
  },
  workspace: {
    defaultPath: '',
    autoSave: true,
    autoSaveInterval: 30000,
    recentWorkspaces: [],
    maxRecentWorkspaces: 10,
  },
  shortcuts: {
    'new-workspace': 'CmdOrCtrl+N',
    'open-workspace': 'CmdOrCtrl+O',
    save: 'CmdOrCtrl+S',
    settings: 'CmdOrCtrl+,',
    'toggle-sidebar': 'CmdOrCtrl+B',
    search: 'CmdOrCtrl+F',
    'command-palette': 'CmdOrCtrl+Shift+P',
  },
  experimental: {
    enableBetaFeatures: false,
    debugMode: false,
  },
  permissions: {
    rules: [],
  },
  userRules: {
    enabled: true,
    rules: [],
  },
  workspaceRules: {
    enabled: true,
    content: '',
    updatedAt: new Date().toISOString(),
  },
};

export class ConfigManager extends EventEmitter {
  private logger: Logger;
  private config: AppConfig;

  constructor() {
    super();
    this.logger = new Logger('ConfigManager');
    // Use in-memory store (browser-compatible)
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing configuration manager');
    // In-memory only, no migration or persistence needed
  }

  // Schema method removed - not needed for in-memory config
  private getSchema(): any {
    return {
      appearance: {
        type: 'object',
        properties: {
          theme: {
            type: 'string',
            enum: ['light', 'dark', 'system'],
          },
          fontSize: {
            type: 'number',
            minimum: 10,
            maximum: 24,
          },
          fontFamily: {
            type: 'string',
          },
        },
      },
      editor: {
        type: 'object',
        properties: {
          tabSize: {
            type: 'number',
            minimum: 1,
            maximum: 8,
          },
          wordWrap: {
            type: 'boolean',
          },
          lineNumbers: {
            type: 'boolean',
          },
          minimap: {
            type: 'boolean',
          },
        },
      },
      ai: {
        type: 'object',
        properties: {
          apiUrl: {
            type: 'string',
            format: 'uri',
          },
          apiToken: {
            type: 'string',
          },
          model: {
            type: 'string',
          },
          temperature: {
            type: 'number',
            minimum: 0,
            maximum: 2,
          },
          maxTokens: {
            type: 'number',
            minimum: 1,
            maximum: 32000,
          },
          streamingSpeed: {
            type: 'number',
            minimum: 1,
            maximum: 100,
          },
        },
      },
      workspace: {
        type: 'object',
        properties: {
          defaultPath: {
            type: 'string',
          },
          autoSave: {
            type: 'boolean',
          },
          autoSaveInterval: {
            type: 'number',
            minimum: 5000,
            maximum: 300000,
          },
          recentWorkspaces: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          maxRecentWorkspaces: {
            type: 'number',
            minimum: 1,
            maximum: 50,
          },
        },
      },
      shortcuts: {
        type: 'object',
        additionalProperties: {
          type: 'string',
        },
      },
      experimental: {
        type: 'object',
        properties: {
          enableBetaFeatures: {
            type: 'boolean',
          },
          debugMode: {
            type: 'boolean',
          },
        },
      },
    };
  }

  private async migrateConfig(): Promise<void> {
    // No migration needed for in-memory config
  }

  private validateConfig(): void {
    // Additional validation beyond schema
    const config = this.config;

    // Ensure API token exists for AI features
    if (!config.ai.apiToken) {
      this.logger.warn('No API token configured for AI features');
    }

    // Validate workspace paths
    if (config.workspace.recentWorkspaces.length > config.workspace.maxRecentWorkspaces) {
      config.workspace.recentWorkspaces = config.workspace.recentWorkspaces.slice(
        0,
        config.workspace.maxRecentWorkspaces,
      );
      this.set('workspace.recentWorkspaces', config.workspace.recentWorkspaces);
    }
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K];
  get(path: string): any;
  get(keyOrPath: string): any {
    if (keyOrPath.includes('.')) {
      // Handle nested path like "workspace.defaultPath"
      const keys = keyOrPath.split('.');
      let result: any = this.config;
      for (const key of keys) {
        if (result && typeof result === 'object' && key in result) {
          result = result[key];
        } else {
          return undefined;
        }
      }
      return result;
    }
    return this.config[keyOrPath as keyof AppConfig];
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void;
  set(path: string, value: any): void;
  set(keyOrPath: string, value: any): void {
    if (keyOrPath.includes('.')) {
      // Handle nested path
      const keys = keyOrPath.split('.');
      const lastKey = keys.pop();
      if (lastKey === undefined) {
        return;
      }
      let target: any = this.config;

      for (const key of keys) {
        if (!(key in target)) {
          target[key] = {};
        }
        target = target[key];
      }

      target[lastKey] = value;
    } else {
      (this.config as any)[keyOrPath] = value;
    }

    this.logger.debug(`Config updated: ${keyOrPath}`, value);
    this.emit('config-changed', this.config);
  }

  getAll(): AppConfig {
    return this.config;
  }

  reset(): void {
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this.logger.info('Configuration reset to defaults');
  }

  async save(): Promise<void> {
    // Store automatically saves, but we can force it
    this.logger.debug('Configuration saved');
  }

  addRecentWorkspace(workspaceId: string): void {
    const recent = this.config.workspace.recentWorkspaces;
    const filtered = recent.filter((id) => id !== workspaceId);
    filtered.unshift(workspaceId);

    if (filtered.length > this.config.workspace.maxRecentWorkspaces) {
      filtered.pop();
    }

    this.set('workspace.recentWorkspaces', filtered);
  }

  removeRecentWorkspace(workspaceId: string): void {
    const recent = this.config.workspace.recentWorkspaces;
    const filtered = recent.filter((id) => id !== workspaceId);
    this.set('workspace.recentWorkspaces', filtered);
  }
}
