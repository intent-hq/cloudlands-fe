/**
 * Live settings domain backed by the intentd daemon (PROTOCOL §5.12).
 *
 * Wraps the four wire methods (`settings.list/get/update/reset`) directly and
 * also exposes the higher-level domain accessors the renderer's settings panels
 * already call (`getMcpServers`, `getProviderSettings`, …). The domain
 * accessors translate FE state shapes ↔ BE setting paths so callers do not
 * need to know the dotted-path catalog:
 *
 *   - `mcp.servers`                       ↔ `getMcpServers` / `setMcpServers`
 *   - `mcp.disabledServers` / `mcp.enableUserServers` are surfaced via `list()`.
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
    const entry = await this.get("mcp.servers");
    if (!entry) return [];
    const value = entry.value;
    return Array.isArray(value) ? (value as McpServerConfig[]) : [];
  }

  async setMcpServers(servers: McpServerConfig[]): Promise<MutationResult> {
    return runMutation("settings.update", {
      changes: [{ path: "mcp.servers", value: servers }],
    });
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

