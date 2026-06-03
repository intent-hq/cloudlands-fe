import type { McpAuthInfo, McpServerConfig, McpServerStatus } from './mcp-settings-types';

const MCP_SERVER_STATUSES: readonly McpServerStatus[] = [
  'connected',
  'configured',
  'disconnected',
  'error',
  'auth_required',
  'disabled',
  'stopped',
];

const MCP_TRANSPORT_TYPES: readonly McpServerConfig['type'][] = ['stdio', 'http', 'sse'];
const MCP_AUTH_TYPES: readonly NonNullable<McpServerConfig['authType']>[] = [
  'oauth',
  'header',
  'none',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableSerialize(value: unknown): string | undefined {
  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (!isRecord(nestedValue) && !Array.isArray(nestedValue)) return nestedValue;
      if (seen.has(nestedValue)) return '[Circular]';
      seen.add(nestedValue);
      if (Array.isArray(nestedValue)) return nestedValue;
      return Object.keys(nestedValue)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = nestedValue[key];
          return acc;
        }, {});
    });
    return serialized === undefined ? undefined : serialized;
  } catch {
    return undefined;
  }
}

function toMcpErrorMessageValue(value: unknown, fallback: string, seen: WeakSet<object>): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value || fallback;
  if (value instanceof Error) return value.message || fallback;
  if (isRecord(value)) {
    if (seen.has(value)) return stableSerialize(value) ?? fallback;
    seen.add(value);
    for (const key of ['message', 'error', 'reason', 'details']) {
      if (key in value) return toMcpErrorMessageValue(value[key], fallback, seen);
    }
  }
  return stableSerialize(value) ?? String(value || fallback);
}

export function toMcpErrorMessage(value: unknown, fallback: string): string {
  return toMcpErrorMessageValue(value, fallback, new WeakSet<object>());
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const strings = value.filter((item): item is string => typeof item === 'string');
    return strings.length > 0 ? strings : undefined;
  }
  if (typeof value === 'string') {
    const strings = value.trim().split(/\s+/).filter(Boolean);
    return strings.length > 0 ? strings : undefined;
  }
  return undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function normalizeMcpAuthType(value: unknown): McpServerConfig['authType'] | undefined {
  return MCP_AUTH_TYPES.includes(value as NonNullable<McpServerConfig['authType']>)
    ? (value as NonNullable<McpServerConfig['authType']>)
    : undefined;
}

export function normalizeMcpServerStatus(value: unknown): McpServerStatus | undefined {
  return MCP_SERVER_STATUSES.includes(value as McpServerStatus)
    ? (value as McpServerStatus)
    : undefined;
}

export function normalizeDisabledServers(value: unknown): Record<string, true> {
  if (!Array.isArray(value)) return {};
  return value.reduce<Record<string, true>>((acc, item) => {
    const name = optionalString(item);
    if (name) acc[name] = true;
    return acc;
  }, {});
}

export function normalizeMcpAuthInfo(value: unknown): McpAuthInfo {
  if (!isRecord(value)) return { requiresAuth: false, hasAuth: false };
  return {
    requiresAuth: value.requiresAuth === true,
    hasAuth: value.hasAuth === true,
    providerName: optionalString(value.providerName),
    providerDisplayName: optionalString(value.providerDisplayName),
    authHint: optionalString(value.authHint),
  };
}

function normalizeMcpServerConfig(value: unknown, fallbackName?: string): McpServerConfig | null {
  if (!isRecord(value)) return null;
  const name = optionalString(value.name) ?? optionalString(fallbackName);
  if (!name) return null;

  const rawType = value.type ?? value.transport;
  const type = MCP_TRANSPORT_TYPES.includes(rawType as McpServerConfig['type'])
    ? (rawType as McpServerConfig['type'])
    : optionalString(value.command)
      ? 'stdio'
      : 'http';

  const config: McpServerConfig = { name, type };
  const command = optionalString(value.command);
  const url = optionalString(value.url);
  const args = stringArray(value.args);
  const env = stringRecord(value.env);
  const headers = stringRecord(value.headers);
  const authType = normalizeMcpAuthType(value.authType);

  if (command) config.command = command;
  if (url) config.url = url;
  if (args) config.args = args;
  if (env) config.env = env;
  if (headers) config.headers = headers;
  if (authType) config.authType = authType;
  if (typeof value.disabled === 'boolean') config.disabled = value.disabled;
  return config;
}

export function normalizeMcpServersPayload(data: unknown): McpServerConfig[] {
  if (Array.isArray(data)) {
    return data.flatMap((item) => normalizeMcpServerConfig(item) ?? []);
  }
  if (!isRecord(data)) return [];

  const nestedServers = data.mcpServers ?? data.servers;
  if (Array.isArray(nestedServers)) {
    return nestedServers.flatMap((item) => normalizeMcpServerConfig(item) ?? []);
  }
  const serverMap = isRecord(nestedServers) ? nestedServers : data;
  return Object.entries(serverMap).flatMap(
    ([name, config]) => normalizeMcpServerConfig(config, name) ?? [],
  );
}
