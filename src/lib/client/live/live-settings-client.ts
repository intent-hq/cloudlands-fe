/**
 * Live settings domain backed by the intentd daemon (PROTOCOL §5.12).
 *
 * Wraps the four wire methods (`settings.list/get/update/reset`) directly and
 * also exposes the higher-level domain accessors the renderer's settings panels
 * already call (`getMcpServers`, `getProviderSettings`, …). The domain
 * accessors translate FE state shapes ↔ BE setting paths so callers do not
 * need to know the dotted-path catalog:
 *
 *   - `mcp.servers.*` (§5.22)             ↔ `getMcpServers` / `setMcpServers`
 *   - `mcp.disabledServers` / `mcp.enableUserServers` are surfaced via `list()`.
 *
 * MCP note: the `mcp.servers` setting is **sensitive** (§5.12) — `settings.get`
 * only ever returns the redacted placeholder — and the daemon persists it as an
 * id→config object owned by the `mcp.servers.*` lifecycle service. The seam's
 * list-shaped accessors therefore translate to the §5.22 CRUD: `getMcpServers`
 * reads `mcp.servers.list`, and `setMcpServers` diffs the desired list against
 * the daemon's and issues `create` / `update` / `delete` / `toggle` calls.
 * Untouched servers never produce an `update`, so their keychain-held `env` /
 * `headers` secrets (redacted on the wire) are preserved; an *edited* server is
 * replaced wholesale per §5.22 semantics.
 *   - `providers.active` / `providers.enabled`            ↔ provider settings
 *   - `backgroundAgents.defaultModel` / `.typeOverrides` /
 *     `.providerSettings`                                 ↔ background agents
 *   - `git.autoCommit`                                    ↔ workspace settings
 *
 * Sensitive entries return a redacted placeholder (§5.12); the client surfaces
 * the raw `value` field verbatim — callers decide how to render the sentinel.
 * Errors fold to `null` / empty result for reads (so a failed boot read leaves
 * the slice at its initial state) and to `{ success: false, error }` for the
 * domain-level mutators.
 */
import type {
  AppClient,
  AppliedSettingChange,
  AppSettingChange,
  MutationResult,
  SettingDefinitionWithValue,
  SettingsClient,
  SubscriptionHandler,
  Unsubscribe,
  UserRuleState,
} from "../app-client";
import type { McpServerConfig } from "$store/renderer/slices/mcp-settings/mcp-settings-types";
import type { ProviderSettingsState } from "$store/renderer/slices/provider-settings/provider-settings-slice";
import type { SingleWorkspaceSettings } from "$store/renderer/slices/workspace-settings/workspace-settings-slice";
import type { BackgroundAgentSettingsState } from "$store/renderer/slices/background-agent-settings/background-agent-settings-slice";
import type { UserPreferencesState } from "$store/renderer/slices/user-preferences/user-preferences-slice";
import { backendRequest } from "./backend-transport";
import { runMutation } from "./live-support";

type UserPrefsResult = UserPreferencesState | null;

/**
 * `rules.get`/`rules.update` (§5.21) require a `workspaceId` on the wire, but
 * the global settings page edits user-override rules that the daemon stores
 * globally (endUserRules): `rules_get` ignores the id entirely and
 * `rules_update` only echoes it back in the returned RuleSet, so a sentinel
 * satisfies the contract without binding the edit to a real workspace.
 */
const GLOBAL_RULES_WORKSPACE_ID = "global";

/** Build a fresh `update` change list, omitting `undefined` values. */
function changesFrom(patch: Record<string, unknown>): AppSettingChange[] {
  const out: AppSettingChange[] = [];
  for (const [path, value] of Object.entries(patch)) {
    if (value !== undefined) out.push({ path, value });
  }
  return out;
}

export class LiveSettingsClient implements SettingsClient {
  async list(): Promise<SettingDefinitionWithValue[]> {
    try {
      const result = await backendRequest<{ settings?: unknown[] }>("settings.list");
      return Array.isArray(result?.settings)
        ? (result.settings as SettingDefinitionWithValue[])
        : [];
    } catch {
      return [];
    }
  }

  async get(path: string): Promise<SettingDefinitionWithValue | null> {
    try {
      const result = await backendRequest<{
        path?: string;
        value?: unknown;
        definition?: Omit<SettingDefinitionWithValue, "value">;
      }>("settings.get", { path });
      if (!result?.definition) return null;
      return { ...result.definition, value: result.value };
    } catch {
      return null;
    }
  }

  async update(changes: AppSettingChange[]): Promise<AppliedSettingChange[]> {
    if (changes.length === 0) return [];
    const result = await backendRequest<{ applied?: AppliedSettingChange[] }>(
      "settings.update",
      { changes },
    );
    return Array.isArray(result?.applied) ? result.applied : [];
  }

  async reset(path: string): Promise<AppliedSettingChange | null> {
    try {
      const result = await backendRequest<{ path?: string; value?: unknown }>(
        "settings.reset",
        { path },
      );
      if (typeof result?.path !== "string") return null;
      return { path: result.path, value: result.value };
    } catch {
      return null;
    }
  }

  async getUserRule(ruleType: string): Promise<UserRuleState | null> {
    try {
      const result = await backendRequest<{
        enabled?: boolean;
        content?: string;
        updatedAt?: number;
      }>("rules.get", { workspaceId: GLOBAL_RULES_WORKSPACE_ID, ruleType });
      if (!result || typeof result.content !== "string") return null;
      return {
        enabled: result.enabled === true,
        content: result.content,
        updatedAt: typeof result.updatedAt === "number" ? result.updatedAt : 0,
      };
    } catch {
      return null;
    }
  }

  async updateUserRule(
    ruleType: string,
    content: string,
    enabled?: boolean,
  ): Promise<MutationResult> {
    return runMutation("rules.update", {
      workspaceId: GLOBAL_RULES_WORKSPACE_ID,
      ruleType,
      content,
      ...(enabled !== undefined ? { enabled } : {}),
    });
  }

  async getUserPreferences(): Promise<UserPrefsResult> {
    // PROTOCOL §5.12 explicitly classifies UserPreferences entries (spellcheck,
    // beta updates, fonts, notifications, …) as FE-only — the daemon does not
    // serve them. Hydration of these continues to come from localStorage via
    // the existing read services; here we surface `null` so callers that
    // explicitly probe the seam see "no BE-owned snapshot" rather than the
    // mock fixture.
    return null;
  }

  async setUserPreferences(_prefs: Partial<UserPreferencesState>): Promise<MutationResult> {
    // FE-only territory — accept as a no-op success so call sites that target
    // the seam unchanged do not regress. Real persistence happens elsewhere.
    return { success: true };
  }

  async getProviderSettings(): Promise<ProviderSettingsState | null> {
    const settings = await this.list();
    const activeProviderId = readString(settings, "providers.active");
    const enabledProviders = readObject(settings, "providers.enabled") as
      | Record<string, boolean>
      | null;
    if (activeProviderId === null && enabledProviders === null) return null;
    return {
      activeProviderId: activeProviderId ?? "",
      enabledProviders: enabledProviders ?? {},
    };
  }

  async setProviderSettings(
    settings: Partial<ProviderSettingsState>,
  ): Promise<MutationResult> {
    return runMutation("settings.update", {
      changes: changesFrom({
        "providers.active": settings.activeProviderId,
        "providers.enabled": settings.enabledProviders,
      }),
    });
  }

  async getMcpServers(): Promise<McpServerConfig[]> {
    const wire = await listWireMcpServers();
    return wire.flatMap((server) => fromWireMcpConfig(server) ?? []);
  }

  async setMcpServers(servers: McpServerConfig[]): Promise<MutationResult> {
    try {
      const existing = await listWireMcpServers();
      const existingByName = new Map<string, WireMcpServerConfig>();
      for (const server of existing) {
        if (typeof server.name === "string" && server.name) {
          existingByName.set(server.name, server);
        }
      }
      const desiredNames = new Set(servers.map((s) => s.name));

      for (const server of existing) {
        if (server.name && server.id && !desiredNames.has(server.name)) {
          await backendRequest("mcp.servers.delete", { serverId: server.id });
        }
      }
      for (const config of servers) {
        const current = existingByName.get(config.name);
        if (!current?.id) {
          await backendRequest("mcp.servers.create", { config: toWireMcpConfig(config) });
          continue;
        }
        if (!sameMcpConfigBody(current, config)) {
          await backendRequest("mcp.servers.update", {
            serverId: current.id,
            config: toWireMcpConfig(config, current.id),
          });
        }
        const desiredEnabled = config.disabled !== true;
        const currentEnabled = current.enabled !== false;
        if (currentEnabled !== desiredEnabled) {
          await backendRequest("mcp.servers.toggle", {
            serverId: current.id,
            enabled: desiredEnabled,
          });
        }
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getWorkspaceSettings(_workspaceId: string): Promise<SingleWorkspaceSettings | null> {
    // The daemon owns `git.autoCommit` globally (settings.rs) — there is no
    // per-workspace branch on the seam today, so every workspaceId surfaces the
    // same value. Mirrors the mock's singleton behavior.
    const entry = await this.get("git.autoCommit");
    if (!entry) return null;
    return { autoCommitEnabled: Boolean(entry.value) };
  }

  async setWorkspaceSettings(
    _workspaceId: string,
    settings: Partial<SingleWorkspaceSettings>,
  ): Promise<MutationResult> {
    return runMutation("settings.update", {
      changes: changesFrom({
        "git.autoCommit": settings.autoCommitEnabled,
      }),
    });
  }

  async getBackgroundAgentSettings(): Promise<BackgroundAgentSettingsState | null> {
    const settings = await this.list();
    const defaultModel = readString(settings, "backgroundAgents.defaultModel");
    const typeOverrides = readObject(settings, "backgroundAgents.typeOverrides") as
      | BackgroundAgentSettingsState["typeOverrides"]
      | null;
    const providerSettings = readObject(settings, "backgroundAgents.providerSettings") as
      | BackgroundAgentSettingsState["providerSettings"]
      | null;
    if (defaultModel === null && typeOverrides === null && providerSettings === null) {
      return null;
    }
    return {
      defaultModel: defaultModel ?? "",
      typeOverrides:
        typeOverrides ?? ({ commit: "", pr: "", review: "", fast: "" } as BackgroundAgentSettingsState["typeOverrides"]),
      providerSettings: providerSettings ?? {},
    };
  }

  async setBackgroundAgentSettings(
    settings: Partial<BackgroundAgentSettingsState>,
  ): Promise<MutationResult> {
    return runMutation("settings.update", {
      changes: changesFrom({
        "backgroundAgents.defaultModel": settings.defaultModel,
        "backgroundAgents.typeOverrides": settings.typeOverrides,
        "backgroundAgents.providerSettings": settings.providerSettings,
      }),
    });
  }

  subscribe(handler: SubscriptionHandler<UserPrefsResult>): Unsubscribe {
    // Settings panels converge via the boot-hydration middleware and the
    // `settings:changed` bridge; the legacy slice-wide subscribe stays a
    // one-shot no-op so existing call sites are unaffected.
    handler(null);
    return () => {};
  }
}

/** Wire `McpServerConfig` (PROTOCOL §5.22) — the daemon's id/transport/enabled shape. */
interface WireMcpServerConfig {
  id?: string;
  name?: string;
  transport?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  scope?: string;
}

/** `mcp.servers.list` (§5.22) — sensitive `env`/`headers` values arrive redacted. */
async function listWireMcpServers(): Promise<WireMcpServerConfig[]> {
  try {
    const result = await backendRequest<{ servers?: WireMcpServerConfig[] }>(
      "mcp.servers.list",
    );
    return Array.isArray(result?.servers) ? result.servers : [];
  } catch {
    return [];
  }
}

/** Map a wire config (§5.22) to the FE `McpServerConfig` shape; `null` when nameless. */
function fromWireMcpConfig(wire: WireMcpServerConfig): McpServerConfig | null {
  if (typeof wire?.name !== "string" || !wire.name) return null;
  const type = wire.transport === "http" || wire.transport === "sse" ? wire.transport : "stdio";
  const config: McpServerConfig = { name: wire.name, type };
  // Carry the daemon-assigned `id` (§5.22) so the events bridge can resolve
  // `mcp.servers:status-changed` payloads back to a server name; opaque to
  // the UI and never authored by callers.
  if (typeof wire.id === "string" && wire.id) config.id = wire.id;
  if (typeof wire.command === "string" && wire.command) config.command = wire.command;
  if (Array.isArray(wire.args)) config.args = wire.args;
  if (wire.env && typeof wire.env === "object") config.env = wire.env;
  if (typeof wire.url === "string" && wire.url) config.url = wire.url;
  if (wire.headers && typeof wire.headers === "object") config.headers = wire.headers;
  if (wire.enabled === false) config.disabled = true;
  return config;
}

/** Map an FE config to the wire shape (§5.22): `type`→`transport`, `disabled`→`enabled`. */
function toWireMcpConfig(config: McpServerConfig, id?: string): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    name: config.name,
    transport: config.type,
    enabled: config.disabled !== true,
  };
  if (id) wire.id = id;
  if (config.command) wire.command = config.command;
  if (config.args) wire.args = config.args;
  if (config.env) wire.env = config.env;
  if (config.url) wire.url = config.url;
  if (config.headers) wire.headers = config.headers;
  return wire;
}

/**
 * Whether the desired FE config matches the daemon's stored body (enabled flag
 * excluded — that is `toggle`'s job). Both sides are compared in the mapped FE
 * shape, so a list that round-tripped through `getMcpServers` unchanged issues
 * no `update` — keeping the daemon's real (redacted-on-the-wire) secrets intact.
 */
function sameMcpConfigBody(current: WireMcpServerConfig, desired: McpServerConfig): boolean {
  const mapped = fromWireMcpConfig(current);
  if (!mapped) return false;
  const sortedEntries = (record?: Record<string, string>) =>
    record ? Object.entries(record).sort(([a], [b]) => a.localeCompare(b)) : null;
  const canonical = (c: McpServerConfig) =>
    JSON.stringify([
      c.name,
      c.type,
      c.command ?? null,
      c.args ?? null,
      sortedEntries(c.env),
      c.url ?? null,
      sortedEntries(c.headers),
    ]);
  return canonical(mapped) === canonical(desired);
}

/** Find a `SettingDefinitionWithValue` by path; `null` when missing or the daemon redacted it. */
function findEntry(
  settings: readonly SettingDefinitionWithValue[],
  path: string,
): SettingDefinitionWithValue | null {
  for (const entry of settings) {
    if (entry.path === path) return entry;
  }
  return null;
}

function readString(
  settings: readonly SettingDefinitionWithValue[],
  path: string,
): string | null {
  const entry = findEntry(settings, path);
  return entry && typeof entry.value === "string" ? entry.value : null;
}

function readObject(
  settings: readonly SettingDefinitionWithValue[],
  path: string,
): Record<string, unknown> | null {
  const entry = findEntry(settings, path);
  if (!entry || entry.value === null || typeof entry.value !== "object") return null;
  return entry.value as Record<string, unknown>;
}

// Tied to AppClient["settings"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient["settings"] | undefined = undefined as
  | LiveSettingsClient
  | undefined;
void _interfaceCheck;

