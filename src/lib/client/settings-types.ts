import type { MutationResult, SubscriptionHandler, Unsubscribe } from './client-types';
import type {
  McpServerConfig,
  McpServerRuntimeStatus,
} from '../../store/renderer/slices/mcp-settings/mcp-settings-types';
import type { UserPreferencesState } from '../../store/renderer/slices/user-preferences/user-preferences-slice';
import type { ProviderSettingsState } from '../../store/renderer/slices/provider-settings/provider-settings-types';
import type { SingleWorkspaceSettings } from '../../store/renderer/slices/workspace-settings/workspace-settings-slice';
import type { BackgroundAgentSettingsState } from '../../store/renderer/slices/background-agent-settings/background-agent-settings-slice';

/**
 * The daemon-persisted subset of provider settings (`model.defaultProvider` /
 * `providers.enabled`, PROTOCOL §5.12). `activeProviderId` carries the default
 * provider — the provider leg of the default model triple (the deprecated
 * `providers.active` key is no longer read or written). The remaining
 * ProviderSettingsState fields are registry snapshots hydrated from
 * `providers.catalog`, never persisted through this seam.
 */
export type PersistedProviderSettings = Pick<ProviderSettingsState, 'enabledProviders'> & {
  activeProviderId: string;
};
/**
 * Wire-level setting definition (PROTOCOL §5.12 `SettingDefinition`). The
 * `value` field is appended by `settings.list` / `settings.get` (the spec calls
 * this `SettingDefinitionWithValue`); sensitive entries surface a redacted
 * placeholder rather than the raw secret.
 */
export interface SettingDefinitionWithValue {
  path: string;
  label: string;
  description: string;
  category: string;
  type: 'boolean' | 'number' | 'string' | 'enum' | 'object';
  enumValues?: string[];
  min?: number;
  max?: number;
  defaultValue?: unknown;
  sensitive?: boolean;
  /** Approximate prompt-token cost of the gated feature (e.g. "~620 tokens/session"); absent when unannotated. */
  tokenImpact?: string;
  value: unknown;
  /** Effective source for TOML-backed settings; absent for other stores. */
  origin?: 'default' | 'file' | 'flag';
  /** Daemon ordering watermark, present on settings.get results. */
  revision?: number;
}

/** Wire-level change entry for `settings.update` (PROTOCOL §5.12 `AppSettingChange`). */
export interface AppSettingChange {
  path: string;
  value: unknown;
  reason?: string;
}

/** Applied entry surfaced by `settings.update` / `settings:changed` (§5.12 / §6.5). */
export interface AppliedSettingChange {
  path: string;
  value: unknown;
  /** Effective source after the commit for TOML-backed settings. */
  origin?: 'default' | 'file' | 'flag';
}

export interface SettingsSnapshot {
  settings: SettingDefinitionWithValue[];
  revision: number;
}

export interface SettingsUpdateResult {
  applied: AppliedSettingChange[];
  revision: number;
}

/** One user-override rule as read via `rules.get` (§5.21). */
export interface UserRuleState {
  enabled: boolean;
  content: string;
  updatedAt: number;
}

export interface SettingsClient {
  /** `settings.list` (§5.12). Returns every BE-owned setting with its current value (sensitive values redacted). */
  list(workspaceId?: string): Promise<SettingDefinitionWithValue[]>;
  listSnapshot?(workspaceId?: string): Promise<SettingsSnapshot>;
  /** `settings.get` (§5.12). Returns the single setting + its definition; `null` when the daemon rejects the path. */
  get(path: string, workspaceId?: string): Promise<SettingDefinitionWithValue | null>;
  /** `settings.update` (§5.12). Atomic batch update; emits `settings:changed` on success. */
  update(changes: AppSettingChange[]): Promise<AppliedSettingChange[]>;
  updateSnapshot?(changes: AppSettingChange[]): Promise<SettingsUpdateResult>;
  /** `settings.reset` (§5.12). Restores one setting to its `defaultValue`. */
  reset(path: string): Promise<AppliedSettingChange | null>;
  /** `rules.get` (§5.21). Reads one global user-override rule type; `null` when the probe fails. */
  getUserRule(ruleType: string, workspaceId?: string): Promise<UserRuleState | null>;
  /** `rules.update` (§5.21). Upserts the global user-override body (+ `enabled`) for one rule type. */
  updateUserRule(ruleType: string, content: string, enabled?: boolean): Promise<MutationResult>;
  getUserPreferences(): Promise<UserPreferencesState | null>;
  setUserPreferences(prefs: Partial<UserPreferencesState>): Promise<MutationResult>;
  getProviderSettings(workspaceId?: string): Promise<PersistedProviderSettings | null>;
  setProviderSettings(settings: Partial<PersistedProviderSettings>): Promise<MutationResult>;
  getMcpServers(workspaceId?: string): Promise<McpServerConfig[]>;
  setMcpServers(servers: McpServerConfig[]): Promise<MutationResult>;
  /**
   * `mcp.servers.getStatus` (§5.22) fanned out per server id. Returns the
   * daemon-reported runtime statuses keyed by `serverId`; ids whose point read
   * fails are omitted (live updates arrive via `mcp.servers:status-changed`).
   */
  getMcpServerStatuses(
    serverIds: string[],
    workspaceId?: string,
  ): Promise<McpServerRuntimeStatus[]>;
  /** `mcp.servers.restart` (§5.22). Restarts/re-probes one daemon-owned server. */
  restartMcpServer(serverId: string): Promise<McpServerRuntimeStatus>;
  /**
   * Workspace-scoped `mcp.servers.list` (§5.22 per-workspace disable). Returns
   * the identity keys (ID, or legacy name) of servers whose entry carries `workspaceDisabled: true`; `null`
   * when the read fails (callers keep their current state).
   */
  getWorkspaceDisabledMcpServerKeys(workspaceId: string): Promise<string[] | null>;
  /**
   * Workspace-scoped `mcp.servers.toggle` (§5.22 per-workspace disable): sets
   * (`enabled: false`) or clears (`enabled: true`) the per-workspace disabled
   * marker only — the global config is untouched. Success carries the daemon's
   * resulting `workspaceDisabled`.
   */
  toggleWorkspaceMcpServer(
    workspaceId: string,
    serverId: string,
    enabled: boolean,
  ): Promise<MutationResult & { workspaceDisabled?: boolean }>;
  getWorkspaceSettings(workspaceId: string): Promise<SingleWorkspaceSettings | null>;
  setWorkspaceSettings(
    workspaceId: string,
    settings: Partial<SingleWorkspaceSettings>,
  ): Promise<MutationResult>;
  getBackgroundAgentSettings(workspaceId?: string): Promise<BackgroundAgentSettingsState | null>;
  setBackgroundAgentSettings(
    settings: Partial<BackgroundAgentSettingsState>,
  ): Promise<MutationResult>;
  subscribe(handler: SubscriptionHandler<UserPreferencesState | null>): Unsubscribe;
}
