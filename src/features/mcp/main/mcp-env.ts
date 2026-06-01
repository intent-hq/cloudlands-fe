/**
 * MCP child-process environment helpers.
 *
 * Stdio MCP servers (the built-in workspace-mcp and user-configured servers)
 * are spawned with an explicit environment. Historically that environment was
 * very narrow, dropping shell variables (PATH, HOME, user-provided tokens, etc.)
 * that external MCP servers expect. These pure helpers build a safe baseline
 * from the parent process environment and merge Intent-required overrides on top.
 *
 * Keep this module dependency-light: no stores, services, or side effects.
 */

/**
 * Keys that Intent always sets explicitly when launching MCP children, so they
 * must not be inherited from the parent process baseline. This keeps control of
 * these values with the explicit overrides rather than ambient inheritance.
 */
export const INTENT_CONTROLLED_ENV_KEYS = ['ELECTRON_RUN_AS_NODE'] as const;

/**
 * Well-known host secret env keys that must NOT be inherited by MCP children.
 * Stdio MCP servers (including untrusted third-party servers) would otherwise
 * receive the host's provider/API credentials via ambient inheritance. An
 * explicit per-server `env` value can still re-introduce any of these keys
 * intentionally — the denylist only filters the parent-process baseline.
 */
export const SECRET_ENV_KEY_DENYLIST = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'HF_TOKEN',
  'NPM_TOKEN',
  'SLACK_TOKEN',
  'FIGMA_TOKEN',
] as const;

const SECRET_ENV_KEY_DENYLIST_SET = new Set<string>(SECRET_ENV_KEY_DENYLIST);

/**
 * Conservative key-name patterns for likely-secret env vars beyond the explicit
 * list. Matched against the upper-cased key name only. Anchored/delimited where
 * a bare substring would risk catching benign vars (e.g. PATH/HOME/LANG); SECRET
 * and TOKEN are matched as `_`-delimited words so they only hit credential-style
 * names, not arbitrary identifiers.
 */
const SECRET_ENV_KEY_PATTERNS: readonly RegExp[] = [
  /API_KEY/,
  /ACCESS_KEY/,
  /PRIVATE_KEY/,
  /PASSWORD/,
  /PASSWD/,
  /CREDENTIAL/,
  /(^|_)SECRET(_|$)/,
  /(^|_)TOKEN(_|$)/,
];

/**
 * Whether an env key name looks like a host secret that should not leak into MCP
 * children via the inherited baseline. Combines the explicit well-known denylist
 * with conservative key-name patterns.
 */
export function isLikelySecretEnvKey(key: string): boolean {
  if (SECRET_ENV_KEY_DENYLIST_SET.has(key)) return true;
  const upper = key.toUpperCase();
  return SECRET_ENV_KEY_PATTERNS.some((pattern) => pattern.test(upper));
}

/** Placeholder used to mask env/header values when logging MCP config. */
export const REDACTED_VALUE = '[redacted]';

type EnvLike = Record<string, string | undefined>;

/**
 * Build a safe baseline environment from the parent process for launching MCP
 * child processes. Drops undefined values, Intent-controlled keys, and keys that
 * look like host secrets (see SECRET_ENV_KEY_DENYLIST / isLikelySecretEnvKey).
 */
export function buildBaselineMcpEnv(
  parentEnv: EnvLike = process.env,
): Record<string, string> {
  const controlled = new Set<string>(INTENT_CONTROLLED_ENV_KEYS);
  const baseline: Record<string, string> = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    if (controlled.has(key)) continue;
    if (isLikelySecretEnvKey(key)) continue;
    baseline[key] = value;
  }
  return baseline;
}

/**
 * Merge env layers left-to-right; later layers win. Undefined values are
 * dropped so an override of `undefined` never blanks a baseline value.
 */
export function mergeMcpEnv(
  ...layers: Array<EnvLike | undefined | null>
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      merged[key] = value;
    }
  }
  return merged;
}

function isStdioServer(server: unknown): server is { command: string; env?: EnvLike } {
  return (
    !!server &&
    typeof server === 'object' &&
    typeof (server as { command?: unknown }).command === 'string'
  );
}

/**
 * Return a copy of an MCP servers map where each stdio (command-based) server's
 * `env` is the parent-process baseline merged with that server's existing env
 * (existing env wins). HTTP/SSE servers are returned unchanged.
 */
export function applyBaselineEnvToStdioServers<T extends Record<string, unknown>>(
  servers: T,
  parentEnv: EnvLike = process.env,
): T {
  const baseline = buildBaselineMcpEnv(parentEnv);
  const out: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(servers)) {
    if (isStdioServer(server)) {
      out[name] = {
        ...(server as Record<string, unknown>),
        env: mergeMcpEnv(baseline, server.env),
      };
    } else {
      out[name] = server;
    }
  }
  return out as T;
}

function redactValues(values: unknown): Record<string, string> | undefined {
  if (!values || typeof values !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const key of Object.keys(values as Record<string, unknown>)) {
    out[key] = REDACTED_VALUE;
  }
  return out;
}

/**
 * Produce a log-safe copy of an MCP config: env values and header values are
 * masked (keys preserved) so debug logs never contain secret values.
 */
export function redactMcpEnvForLogging(config: {
  mcpServers: Record<string, unknown>;
}): { mcpServers: Record<string, unknown> } {
  const mcpServers: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(config.mcpServers)) {
    if (!server || typeof server !== 'object') {
      mcpServers[name] = server;
      continue;
    }
    const src = server as Record<string, unknown>;
    const redacted: Record<string, unknown> = { ...src };
    if ('env' in src) redacted.env = redactValues(src.env) ?? {};
    if ('headers' in src) redacted.headers = redactValues(src.headers) ?? {};
    mcpServers[name] = redacted;
  }
  return { mcpServers };
}
