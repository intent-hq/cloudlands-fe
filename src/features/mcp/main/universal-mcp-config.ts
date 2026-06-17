/**
 * Universal MCP config conversion utilities.
 *
 * We store user MCP servers in Augment settings (~/.augment/settings.json) using a format that
 * is compatible with Auggie. Other ACP providers (OpenCode, Claude Code, Codex) each expect
 * different MCP configuration formats.
 *
 * This module normalizes our internal representation into a canonical shape and then converts
 * to provider-specific formats.
 */

import type {
  McpServerCommandConfig,
  McpServerConfig,
  McpServerHttpConfig,
  McpServerSseConfig,
} from './user-mcp-settings';

export type NormalizedMcpServer =
  | {
      kind: 'stdio';
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  | {
      kind: 'http' | 'sse';
      url: string;
      headers?: Record<string, string>;
    };

export type NormalizedMcpServers = Record<string, NormalizedMcpServer>;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCommandServer(config: McpServerCommandConfig): NormalizedMcpServer {
  return {
    kind: 'stdio',
    command: config.command,
    args: config.args ?? [],
    env: config.env ?? {},
  };
}

function normalizeHttpServer(config: McpServerHttpConfig): NormalizedMcpServer {
  return {
    kind: 'http',
    url: config.url,
    headers: config.headers,
  };
}

function normalizeSseServer(config: McpServerSseConfig): NormalizedMcpServer {
  return {
    kind: 'sse',
    url: config.url,
    headers: config.headers,
  };
}

/**
 * Normalize a set of MCP servers into a canonical shape.
 *
 * We accept a slightly broader input than our TS types because different callers
 * may provide legacy configs (e.g. `{ url: "..." }` without a `type`).
 */
export function normalizeMcpServers(
  servers: Record<string, McpServerConfig>,
): NormalizedMcpServers {
  const out: NormalizedMcpServers = {};

  for (const [name, raw] of Object.entries(servers)) {
    // Typed formats from ~/.augment/settings.json.
    if ((raw as any)?.type === 'http') {
      out[name] = normalizeHttpServer(raw as McpServerHttpConfig);
      continue;
    }
    if ((raw as any)?.type === 'sse') {
      out[name] = normalizeSseServer(raw as McpServerSseConfig);
      continue;
    }

    // Command configs may not have a `type` field.
    if (isObject(raw) && typeof raw.command === 'string') {
      out[name] = normalizeCommandServer(raw as McpServerCommandConfig);
      continue;
    }

    // Legacy/lenient: allow `{ url: "..." }` with optional headers.
    if (isObject(raw) && typeof raw.url === 'string') {
      const headers = isObject(raw.headers)
        ? Object.fromEntries(Object.entries(raw.headers).map(([k, v]) => [k, String(v)]))
        : undefined;
      out[name] = { kind: 'http', url: raw.url, headers };
      continue;
    }
  }

  return out;
}

/**
 * Convert to OpenCode config `mcp` block.
 *
 * Docs: https://opencode.ai/docs/mcp-servers/
 */
export function toOpenCodeMcpConfig(normalized: NormalizedMcpServers): Record<string, unknown> {
  const mcp: Record<string, unknown> = {};

  for (const [name, server] of Object.entries(normalized)) {
    if (server.kind === 'stdio') {
      mcp[name] = {
        type: 'local',
        command: [server.command, ...server.args],
        enabled: true,
        environment: server.env,
      };
      continue;
    }

    // OpenCode uses a single `remote` type. It supports streamable HTTP; SSE remotes
    // are still represented by a URL (best-effort).
    mcp[name] = {
      type: 'remote',
      url: server.url,
      enabled: true,
      ...(server.headers ? { headers: server.headers } : {}),
    };
  }

  return mcp;
}

/**
 * Convert to Claude Code `.mcp.json` format.
 *
 * (Verified via `claude mcp add --scope project ...` output.)
 */
export function toClaudeMcpJson(normalized: NormalizedMcpServers): {
  mcpServers: Record<string, unknown>;
} {
  const mcpServers: Record<string, unknown> = {};

  for (const [name, server] of Object.entries(normalized)) {
    if (server.kind === 'stdio') {
      mcpServers[name] = {
        type: 'stdio',
        command: server.command,
        args: server.args,
        env: server.env,
      };
      continue;
    }

    mcpServers[name] = {
      type: server.kind,
      url: server.url,
      ...(server.headers ? { headers: server.headers } : {}),
    };
  }

  return { mcpServers };
}

/**
 * Convert to Pi `~/.pi/agent/mcp.json` format.
 */
export function toPiMcpJson(normalized: NormalizedMcpServers): {
  mcpServers: Record<string, unknown>;
} {
  const mcpServers: Record<string, unknown> = {};

  for (const [name, server] of Object.entries(normalized)) {
    if (server.kind === 'stdio') {
      mcpServers[name] = {
        command: server.command,
        args: server.args,
        ...(Object.keys(server.env).length > 0 ? { env: server.env } : {}),
      };
      continue;
    }

    mcpServers[name] = {
      type: server.kind,
      url: server.url,
      ...(server.headers ? { headers: server.headers } : {}),
    };
  }

  return { mcpServers };
}

/**
 * ACP McpServer types – matches the ACP protocol format for session/new mcpServers.
 *
 * The ACP SDK validates these with Zod and ALL fields are required:
 * - Stdio: name, command, args, env
 * - HTTP/SSE: name, type, url, headers
 * Use empty arrays (`[]`) when there are no args/env/headers.
 */
export type AcpMcpServer =
  | {
      name: string;
      command: string;
      args: string[];
      env: Array<{ name: string; value: string }>;
    }
  | {
      name: string;
      type: 'http' | 'sse';
      url: string;
      headers: Array<{ name: string; value: string }>;
    };

/**
 * Convert to ACP `session/new` `mcpServers` format.
 *
 * The ACP protocol expects an array of server objects with `name` as a field
 * (not a key). `env` and `headers` are arrays of `{ name, value }` pairs.
 */
export function toAcpMcpServers(normalized: NormalizedMcpServers): AcpMcpServer[] {
  const servers: AcpMcpServer[] = [];

  for (const [name, server] of Object.entries(normalized)) {
    if (server.kind === 'stdio') {
      servers.push({
        name,
        command: server.command,
        args: server.args,
        env: Object.entries(server.env).map(([k, v]) => ({ name: k, value: v })),
      });
      continue;
    }

    servers.push({
      name,
      type: server.kind,
      url: server.url,
      headers: server.headers
        ? Object.entries(server.headers).map(([k, v]) => ({ name: k, value: v }))
        : [],
    });
  }

  return servers;
}

function tomlStringLiteral(value: string): string {
  // TOML basic string; escape backslashes and quotes.
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `"${escaped}"`;
}

function tomlStringArrayLiteral(values: string[]): string {
  return `[${values.map((v) => tomlStringLiteral(v)).join(', ')}]`;
}

function tomlInlineTableLiteral(map: Record<string, string>): string {
  const entries = Object.entries(map);
  if (entries.length === 0) return '{}';
  const parts = entries.map(([k, v]) => {
    const key = /^[A-Za-z0-9_-]+$/.test(k) ? k : tomlStringLiteral(k);
    return `${key} = ${tomlStringLiteral(v)}`;
  });
  return `{ ${parts.join(', ')} }`;
}

export type CodexConfigOverride = {
  key: string;
  tomlValue: string;
};

/**
 * Convert to Codex `-c key=value` overrides.
 *
 * Docs:
 * - https://developers.openai.com/codex/mcp
 * - https://developers.openai.com/codex/config-reference (mcp_servers.*)
 */
export function toCodexMcpOverrides(normalized: NormalizedMcpServers): CodexConfigOverride[] {
  const overrides: CodexConfigOverride[] = [];

  for (const [name, server] of Object.entries(normalized)) {
    const base = `mcp_servers.${name}`;

    if (server.kind === 'stdio') {
      overrides.push({ key: `${base}.command`, tomlValue: tomlStringLiteral(server.command) });
      overrides.push({ key: `${base}.args`, tomlValue: tomlStringArrayLiteral(server.args) });
      overrides.push({ key: `${base}.env`, tomlValue: tomlInlineTableLiteral(server.env) });
      overrides.push({ key: `${base}.enabled`, tomlValue: 'true' });
      continue;
    }

    overrides.push({ key: `${base}.url`, tomlValue: tomlStringLiteral(server.url) });
    if (server.headers && Object.keys(server.headers).length > 0) {
      overrides.push({
        key: `${base}.http_headers`,
        tomlValue: tomlInlineTableLiteral(server.headers),
      });
    }
    overrides.push({ key: `${base}.enabled`, tomlValue: 'true' });
  }

  return overrides;
}
