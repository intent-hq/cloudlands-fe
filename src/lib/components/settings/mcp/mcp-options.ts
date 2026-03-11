/**
 * MCP Server Preset Options
 *
 * Pre-configured MCP servers for easy one-click installation.
 * Ported from VS Code extension's mcp-options.ts
 */

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

// MCP preset options data
export const mcpOptions: McpInstallOption[] = [
  {
    label: 'Figma',
    description: 'Interact with Figma design files and metadata.',
    iconName: 'figma',
    type: 'http',
    url: 'https://mcp.figma.com/mcp',
    authType: 'oauth',
  },
  {
    label: 'Slack',
    description: 'Read from and post to Slack channels.',
    iconName: 'slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    userInput: [
      {
        label: 'Slack Bot Token',
        description: 'Enter your Slack Bot Token (xoxb-...)',
        placeholder: 'xoxb-...',
        type: 'environmentVariable',
        envVarName: 'SLACK_BOT_TOKEN',
      },
      {
        label: 'Slack Team ID',
        description: 'Enter your Slack Team ID (optional)',
        placeholder: 'T01234567',
        type: 'environmentVariable',
        envVarName: 'SLACK_TEAM_ID',
      },
    ],
  },
  {
    label: 'Redis',
    description: 'Real-time data platform for building fast apps',
    iconName: 'redis',
    command: 'uvx',
    args: ['--from', 'redis-mcp-server@latest', 'redis-mcp-server', '--url'],
    userInput: [
      {
        label: 'Redis connection URL',
        description: 'Enter your connection URL (redis://localhost:6379/0)',
        placeholder: 'rediss://<USERNAME>:<PASSWORD>@<HOST>:<PORT>',
        correspondingArg: '--url',
        type: 'argument',
      },
    ],
  },
  {
    label: 'MongoDB',
    description: 'Optimize database queries and performance.',
    iconName: 'mongodb',
    command: 'npx',
    args: ['-y', 'mongodb-mcp-server', '--connectionString'],
    userInput: [
      {
        label: 'MongoDB Connection String',
        description: 'Enter your MongoDB connection string',
        placeholder: 'mongodb://username:password@host:port/database', // pragma: allowlist secret
        correspondingArg: '--connectionString',
        type: 'argument',
      },
    ],
  },
  {
    label: 'CircleCI',
    description: 'Debug builds and improve CI/CD pipelines.',
    iconName: 'circleci',
    command: 'npx',
    args: ['-y', '@circleci/mcp-server-circleci'],
    userInput: [
      {
        label: 'CircleCI Token',
        description: 'Enter your CircleCI token',
        placeholder: 'YOUR_CIRCLE_CI_TOKEN',
        type: 'environmentVariable',
        envVarName: 'CIRCLECI_TOKEN',
      },
      {
        label: 'Base URL',
        description: 'Enter the base URL for your CircleCI instance',
        placeholder: 'https://circleci.com',
        defaultValue: 'https://circleci.com',
        type: 'environmentVariable',
        envVarName: 'CIRCLECI_BASE_URL',
      },
    ],
  },
  {
    label: 'Vercel',
    description: 'Manage deployments, projects, and search docs.',
    iconName: 'vercel',
    command: 'npx',
    args: ['-y', 'mcp-remote', 'https://mcp.vercel.com'],
    userInput: [],
  },
  {
    label: 'Railway',
    description: 'Simplifies infrastructure from servers to observability.',
    iconName: 'railway',
    command: 'npx',
    args: ['-y', '@railway/mcp-server'],
    userInput: [],
  },
  {
    label: 'Convex',
    description: 'The backend platform that keeps your app in sync.',
    iconName: 'convex',
    command: 'npx',
    args: ['-y', 'convex@latest', 'mcp', 'start'],
    userInput: [],
  },
  {
    label: 'Snowflake',
    description: 'Cortex AI, object management, SQL orchestration.',
    iconName: 'snowflake',
    command: 'uvx',
    args: ['snowflake-labs-mcp', '--service-config-file'],
    userInput: [
      {
        label: 'Service Config File Path',
        description: 'Path to your Snowflake MCP configuration YAML file',
        placeholder: '/path/to/config.yaml',
        correspondingArg: '--service-config-file',
        type: 'argument',
      },
    ],
  },
  {
    label: 'Context7',
    description: 'Package documentation lookup.',
    iconName: 'context7',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp@latest'],
    userInput: [],
  },
  {
    label: 'Playwright',
    description: 'Browser automation and testing.',
    iconName: 'playwright',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    userInput: [],
  },
  {
    label: 'Sequential Thinking',
    description: 'Think through complex problems step-by-step.',
    iconName: 'brain',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    userInput: [],
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
