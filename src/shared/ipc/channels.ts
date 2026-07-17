/**
 * Centralized IPC Channel Definitions
 *
 * This module provides type-safe access to all IPC channels in the application.
 * It serves as the single source of truth for channel names and is used to:
 * 1. Generate the preload whitelist
 * 2. Provide type-safe channel references
 * 3. Enable IDE autocomplete for channel names
 *
 * When adding new channels:
 * 1. Add them to the appropriate category below
 * 2. Run: npm run generate:ipc-channels
 * 3. The preload whitelist will automatically update
 */

import { IPC_CHANNELS } from '../ipc-registry';

// Re-export organized channel constants by domain
export const AGENT_CHANNELS = IPC_CHANNELS.AGENT;
export const AGENT_BACKEND_CHANNELS = IPC_CHANNELS.AGENT_BACKEND;
export const WORKSPACE_CHANNELS = IPC_CHANNELS.WORKSPACE;
export const FILE_CHANNELS = IPC_CHANNELS.FILE;
export const SYSTEM_CHANNELS = IPC_CHANNELS.SYSTEM;
export const TERMINAL_CHANNELS = IPC_CHANNELS.TERMINAL;
export const WINDOW_CHANNELS = IPC_CHANNELS.WINDOW;
export const APP_CHANNELS = IPC_CHANNELS.APP;
export const CONFIG_CHANNELS = IPC_CHANNELS.CONFIG;
export const GIT_CHANNELS = IPC_CHANNELS.GIT;
export const EVENTS_CHANNELS = IPC_CHANNELS.EVENTS;
export const AUGGIE_CHANNELS = IPC_CHANNELS.AUGGIE;
export const OPENCODE_CHANNELS = IPC_CHANNELS.OPENCODE;
export const CLAUDE_CODE_CHANNELS = IPC_CHANNELS.CLAUDE_CODE;
export const CODEX_CHANNELS = IPC_CHANNELS.CODEX;
export const CORTEX_CHANNELS = IPC_CHANNELS.CORTEX;
export const PI_CHANNELS = IPC_CHANNELS.PI;
export const DROID_CHANNELS = IPC_CHANNELS.DROID;
export const PROVIDERS_CHANNELS = IPC_CHANNELS.PROVIDERS;
export const SOURCES_CHANNELS = IPC_CHANNELS.SOURCES;
export const DIALOG_CHANNELS = IPC_CHANNELS.DIALOG;
export const SHELL_CHANNELS = IPC_CHANNELS.SHELL;
export const SETTINGS_CHANNELS = IPC_CHANNELS.SETTINGS;
export const FEATURE_CODES_CHANNELS = IPC_CHANNELS.FEATURE_CODES;
export const USER_MCP_CHANNELS = IPC_CHANNELS.USER_MCP;
export const NOTIFICATION_CHANNELS = IPC_CHANNELS.NOTIFICATION;
export const DEEP_LINK_CHANNELS = IPC_CHANNELS.DEEP_LINK;
export const VSCODE_CHANNELS = IPC_CHANNELS.VSCODE;
export const JETBRAINS_CHANNELS = IPC_CHANNELS.JETBRAINS;
export const XCODE_CHANNELS = IPC_CHANNELS.XCODE;
export const LEGACY_CHANNELS = IPC_CHANNELS.LEGACY;
export const RECOVERY_CHANNELS = IPC_CHANNELS.RECOVERY;
export const STREAMING_CHANNELS = IPC_CHANNELS.STREAMING;
export const STORAGE_CHANNELS = IPC_CHANNELS.STORAGE;
export const FIRST_VISIT_CHANNELS = IPC_CHANNELS.FIRST_VISIT;
export const PANEL_LAYOUT_CHANNELS = IPC_CHANNELS.PANEL_LAYOUT;
export const FILE_TRACKING_CHANNELS = IPC_CHANNELS.FILE_TRACKING;
export const LOG_CHANNELS = IPC_CHANNELS.LOG;
export const AGENT_TESTING_CHANNELS = IPC_CHANNELS.AGENT_TESTING;
export const RULES_CHANNELS = IPC_CHANNELS.RULES;
export const SPECIALISTS_CHANNELS = IPC_CHANNELS.SPECIALISTS;
export const USER_RULES_CHANNELS = IPC_CHANNELS.USER_RULES;
export const MEMORIES_CHANNELS = IPC_CHANNELS.MEMORIES;
export const USER_ACTIVITY_CHANNELS = IPC_CHANNELS.USER_ACTIVITY;
export const DIFFS_CHANNELS = IPC_CHANNELS.DIFFS;
export const REMOTE_FS_CHANNELS = IPC_CHANNELS.REMOTE_FS;
export const GIT_TRACKING_CHANNELS = IPC_CHANNELS.GIT_TRACKING;
export const GIT_EXT_CHANNELS = IPC_CHANNELS.GIT_EXT;
export const EDITOR_CHANNELS = IPC_CHANNELS.EDITOR;
export const DEBUG_CHANNELS = IPC_CHANNELS.DEBUG;
export const CHAT_EXPORT_CHANNELS = IPC_CHANNELS.CHAT_EXPORT;
export const PIP_CHANNELS = IPC_CHANNELS.PIP;
export const BANNER_CHANNELS = IPC_CHANNELS.BANNER;
export const SKILLS_CHANNELS = IPC_CHANNELS.SKILLS;
export const SCRIPTS_CHANNELS = IPC_CHANNELS.SCRIPTS;
export const TOKEN_USAGE_CHANNELS = IPC_CHANNELS.TOKEN_USAGE;
export const WEBSOCKET_API_CHANNELS = IPC_CHANNELS.WEBSOCKET_API;

// All channels combined
export const ALL_CHANNELS = IPC_CHANNELS;

// Type for all channel names
export type ChannelName = string & { readonly __brand: 'ChannelName' };

// Helper to create branded channel names
export function createChannelName(channel: string): ChannelName {
  return channel as ChannelName;
}

// Generate arrays for whitelisting
export function getAgentChannels(): string[] {
  return Object.values(AGENT_CHANNELS).filter((v) => typeof v === 'string');
}

export function getWorkspaceChannels(): string[] {
  return Object.values(WORKSPACE_CHANNELS).filter((v) => typeof v === 'string');
}

export function getFileChannels(): string[] {
  return Object.values(FILE_CHANNELS).filter((v) => typeof v === 'string');
}

export function getSystemChannels(): string[] {
  return Object.values(SYSTEM_CHANNELS).filter((v) => typeof v === 'string');
}

export function getTerminalChannels(): string[] {
  return Object.values(TERMINAL_CHANNELS).filter((v) => typeof v === 'string');
}

// Get all static channels
export function getAllStaticChannels(): string[] {
  const channels: string[] = [];

  function extractChannels(obj: any) {
    for (const key in obj) {
      const value = obj[key];
      if (typeof value === 'string') {
        channels.push(value);
      } else if (typeof value === 'object' && value !== null) {
        extractChannels(value);
      }
    }
  }

  extractChannels(ALL_CHANNELS);
  return channels;
}

// Channel metadata for documentation and validation
export const CHANNEL_METADATA: Record<
  string,
  {
    description: string;
    requiresAuth?: boolean;
    rateLimit?: number;
    category: string;
  }
> = {
  // Agent channels
  [AGENT_CHANNELS.CREATE]: {
    description: 'Create a new agent',
    requiresAuth: true,
    category: 'agent',
  },
  [AGENT_CHANNELS.SEND_MESSAGE]: {
    description: 'Send message to agent',
    requiresAuth: true,
    rateLimit: 10,
    category: 'agent',
  },

  // Workspace channels
  [WORKSPACE_CHANNELS.CREATE]: {
    description: 'Create a new space',
    requiresAuth: true,
    category: 'workspace',
  },
  [WORKSPACE_CHANNELS.LIST]: {
    description: 'List all spaces',
    category: 'workspace',
  },
  [WORKSPACE_CHANNELS.GET_DIFF_SUMMARY]: {
    description: 'Get on-demand diff summary for a workspace (not embedded in metadata payloads)',
    category: 'workspace',
  },
  [WORKSPACE_CHANNELS.GET_GIT_SUMMARY]: {
    description: 'Get on-demand git summary for a workspace (not embedded in metadata payloads)',
    category: 'workspace',
  },
  [WORKSPACE_CHANNELS.GET_TASKS]: {
    description: 'Get on-demand task list for a workspace (not embedded in metadata payloads)',
    category: 'workspace',
  },

  // File channels
  [FILE_CHANNELS.READ]: {
    description: 'Read file contents',
    category: 'file',
  },
  [FILE_CHANNELS.WRITE]: {
    description: 'Write file contents',
    requiresAuth: true,
    category: 'file',
  },
};
