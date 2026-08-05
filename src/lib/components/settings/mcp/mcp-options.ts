/**
 * MCP Server Preset Options
 *
 * Pre-configured MCP servers for easy one-click installation.
 * Ported from VS Code extension's mcp-options.ts
 */

import { m } from '$shared/paraglide/messages.js';
import type { McpTransportType, McpAuthType } from './types';

export type UserInputType = 'argument' | 'environmentVariable';

export interface UserInputConfig {
  label: string;
  description?: string;
  placeholder?: string;
  correspondingArg?: string;
  type: UserInputType;
  envVarName?: string;
  defaultValue?: string;
}

export interface McpInstallOption {
  label: string;
  description: string;
  iconName: string;
  // For stdio presets
  command?: string;
  args?: string[];
  userInput?: UserInputConfig[];
  // For http/sse presets
  type?: McpTransportType;
  url?: string;
  authType?: McpAuthType;
}

// MCP preset options data. `label` doubles as the server-name identifier
// (normalizeServerName), so labels stay literal; localized copy uses getters
// so it re-evaluates with the active locale on each render.
export const mcpOptions: McpInstallOption[] = [
  {
    label: 'Figma',
    get description() {
      return m.settings_mcp_preset_figma_description();
    },
    iconName: 'figma',
    type: 'http',
    url: 'https://mcp.figma.com/mcp',
    authType: 'oauth',
  },
  {
    label: 'Redis',
    get description() {
      return m.settings_mcp_preset_redis_description();
    },
    iconName: 'redis',
    command: 'uvx',
    args: ['--from', 'redis-mcp-server@latest', 'redis-mcp-server', '--url'],
    userInput: [
      {
        get label() {
          return m.settings_mcp_preset_redis_urlInput_label();
        },
        get description() {
          return m.settings_mcp_preset_redis_urlInput_description();
        },
        placeholder: 'rediss://<USERNAME>:<PASSWORD>@<HOST>:<PORT>',
        correspondingArg: '--url',
        type: 'argument',
      },
    ],
  },
  {
    label: 'MongoDB',
    get description() {
      return m.settings_mcp_preset_mongodb_description();
    },
    iconName: 'mongodb',
    command: 'npx',
    args: ['-y', 'mongodb-mcp-server', '--connectionString'],
    userInput: [
      {
        get label() {
          return m.settings_mcp_preset_mongodb_connectionInput_label();
        },
        get description() {
          return m.settings_mcp_preset_mongodb_connectionInput_description();
        },
        placeholder: 'mongodb://username:password@host:port/database', // pragma: allowlist secret
        correspondingArg: '--connectionString',
        type: 'argument',
      },
    ],
  },
  {
    label: 'CircleCI',
    get description() {
      return m.settings_mcp_preset_circleci_description();
    },
    iconName: 'circleci',
    command: 'npx',
    args: ['-y', '@circleci/mcp-server-circleci'],
    userInput: [
      {
        get label() {
          return m.settings_mcp_preset_circleci_tokenInput_label();
        },
        get description() {
          return m.settings_mcp_preset_circleci_tokenInput_description();
        },
        placeholder: 'YOUR_CIRCLE_CI_TOKEN',
        type: 'environmentVariable',
        envVarName: 'CIRCLECI_TOKEN',
      },
      {
        get label() {
          return m.settings_mcp_preset_circleci_baseUrlInput_label();
        },
        get description() {
          return m.settings_mcp_preset_circleci_baseUrlInput_description();
        },
        placeholder: 'https://circleci.com',
        defaultValue: 'https://circleci.com',
        type: 'environmentVariable',
        envVarName: 'CIRCLECI_BASE_URL',
      },
    ],
  },
  {
    label: 'Vercel',
    get description() {
      return m.settings_mcp_preset_vercel_description();
    },
    iconName: 'vercel',
    command: 'npx',
    args: ['-y', 'mcp-remote', 'https://mcp.vercel.com'],
    userInput: [],
  },
  {
    label: 'Railway',
    get description() {
      return m.settings_mcp_preset_railway_description();
    },
    iconName: 'railway',
    command: 'npx',
    args: ['-y', '@railway/mcp-server'],
    userInput: [],
  },
  {
    label: 'Convex',
    get description() {
      return m.settings_mcp_preset_convex_description();
    },
    iconName: 'convex',
    command: 'npx',
    args: ['-y', 'convex@latest', 'mcp', 'start'],
    userInput: [],
  },
  {
    label: 'Snowflake',
    get description() {
      return m.settings_mcp_preset_snowflake_description();
    },
    iconName: 'snowflake',
    command: 'uvx',
    args: ['snowflake-labs-mcp', '--service-config-file'],
    userInput: [
      {
        get label() {
          return m.settings_mcp_preset_snowflake_configInput_label();
        },
        get description() {
          return m.settings_mcp_preset_snowflake_configInput_description();
        },
        placeholder: '/path/to/config.yaml',
        correspondingArg: '--service-config-file',
        type: 'argument',
      },
    ],
  },
  {
    label: 'Context7',
    get description() {
      return m.settings_mcp_preset_context7_description();
    },
    iconName: 'context7',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp@latest'],
    userInput: [],
  },
  {
    label: 'Playwright',
    get description() {
      return m.settings_mcp_preset_playwright_description();
    },
    iconName: 'playwright',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    userInput: [],
  },
  {
    // i18n-ignore (label doubles as the server-name identifier)
    label: 'Sequential Thinking',
    get description() {
      return m.settings_mcp_preset_sequentialThinking_description();
    },
    iconName: 'brain',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    userInput: [],
  },
  {
    label: 'Slack',
    get description() {
      return m.settings_mcp_preset_slack_description();
    },
    iconName: 'slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    userInput: [
      {
        get label() {
          return m.settings_mcp_preset_slack_botTokenInput_label();
        },
        get description() {
          return m.settings_mcp_preset_slack_botTokenInput_description();
        },
        placeholder: 'xoxb-...',
        type: 'environmentVariable',
        envVarName: 'SLACK_BOT_TOKEN',
      },
      {
        get label() {
          return m.settings_mcp_preset_slack_teamIdInput_label();
        },
        get description() {
          return m.settings_mcp_preset_slack_teamIdInput_description();
        },
        placeholder: 'T01234567',
        type: 'environmentVariable',
        envVarName: 'SLACK_TEAM_ID',
      },
    ],
  },
];

/** Normalize a label or server name for comparison (lowercase, spaces → hyphens) */
export function normalizeServerName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Check if a server with this label already exists
 */
export function isServerInstalled(label: string, installedServers: { name: string }[]): boolean {
  const normalized = normalizeServerName(label);
  return installedServers.some((s) => normalizeServerName(s.name) === normalized);
}

/**
 * Find a matching preset for a server by name
 */
export function findMatchingPreset(serverName: string): McpInstallOption | undefined {
  const normalized = normalizeServerName(serverName);
  return mcpOptions.find((opt) => normalizeServerName(opt.label) === normalized);
}
