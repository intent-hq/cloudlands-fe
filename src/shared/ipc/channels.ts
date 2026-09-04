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
export const WORKSPACE_CHANNELS = IPC_CHANNELS.WORKSPACE;
export const FILE_CHANNELS = IPC_CHANNELS.FILE;
export const SYSTEM_CHANNELS = IPC_CHANNELS.SYSTEM;
export const TERMINAL_CHANNELS = IPC_CHANNELS.TERMINAL;
export const WINDOW_CHANNELS = IPC_CHANNELS.WINDOW;
export const APP_CHANNELS = IPC_CHANNELS.APP;
export const QUIT_CONFIRMATION_CHANNELS = IPC_CHANNELS.QUIT_CONFIRMATION;
export const CONFIG_CHANNELS = IPC_CHANNELS.CONFIG;
export const EVENTS_CHANNELS = IPC_CHANNELS.EVENTS;
export const AUGGIE_CHANNELS = IPC_CHANNELS.AUGGIE;
export const OPENCODE_CHANNELS = IPC_CHANNELS.OPENCODE;
export const CLAUDE_CODE_CHANNELS = IPC_CHANNELS.CLAUDE_CODE;
export const CODEX_CHANNELS = IPC_CHANNELS.CODEX;
export const CORTEX_CHANNELS = IPC_CHANNELS.CORTEX;
export const PI_CHANNELS = IPC_CHANNELS.PI;
export const DROID_CHANNELS = IPC_CHANNELS.DROID;
export const GROK_CHANNELS = IPC_CHANNELS.GROK;
export const UNSLOTH_CHANNELS = IPC_CHANNELS.UNSLOTH;
export const ANTIGRAVITY_CHANNELS = IPC_CHANNELS.ANTIGRAVITY;
export const PROVIDERS_CHANNELS = IPC_CHANNELS.PROVIDERS;
export const DIALOG_CHANNELS = IPC_CHANNELS.DIALOG;
export const SHELL_CHANNELS = IPC_CHANNELS.SHELL;
export const SETTINGS_CHANNELS = IPC_CHANNELS.SETTINGS;
export const FEATURE_CODES_CHANNELS = IPC_CHANNELS.FEATURE_CODES;
export const USER_MCP_CHANNELS = IPC_CHANNELS.USER_MCP;
export const VOICE_CHANNELS = IPC_CHANNELS.VOICE;
export const NOTIFICATION_CHANNELS = IPC_CHANNELS.NOTIFICATION;
export const DEEP_LINK_CHANNELS = IPC_CHANNELS.DEEP_LINK;
export const VSCODE_CHANNELS = IPC_CHANNELS.VSCODE;
export const JETBRAINS_CHANNELS = IPC_CHANNELS.JETBRAINS;
export const XCODE_CHANNELS = IPC_CHANNELS.XCODE;
export const LEGACY_CHANNELS = IPC_CHANNELS.LEGACY;
export const FIRST_VISIT_CHANNELS = IPC_CHANNELS.FIRST_VISIT;
export const PANEL_LAYOUT_CHANNELS = IPC_CHANNELS.PANEL_LAYOUT;
export const LOG_CHANNELS = IPC_CHANNELS.LOG;
export const RULES_CHANNELS = IPC_CHANNELS.RULES;
export const SPECIALISTS_CHANNELS = IPC_CHANNELS.SPECIALISTS;
export const USER_RULES_CHANNELS = IPC_CHANNELS.USER_RULES;
export const USER_ACTIVITY_CHANNELS = IPC_CHANNELS.USER_ACTIVITY;
export const EDITOR_CHANNELS = IPC_CHANNELS.EDITOR;

// All channels combined
const ALL_CHANNELS = IPC_CHANNELS;

// Type for all channel names
export type ChannelName = string & { readonly __brand: 'ChannelName' };

// Helper to create branded channel names
export function createChannelName(channel: string): ChannelName {
  return channel as ChannelName;
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
