import { THEME_PRESET_IDS, THEME_PRESET_MANIFEST } from './theme-presets-manifest';
import { locales } from './paraglide/runtime.js';
import { SYSTEM_LANGUAGE_PREFERENCE } from './i18n/locale-matcher';

export type AppSettingValueType =
  | 'string'
  | 'boolean'
  | 'number'
  | 'object'
  | 'array'
  | 'enum'
  | 'status'
  | 'readonly';

export type AppSettingSource =
  /**
   * Deprecated tombstone. No APP_SETTING_DEFINITIONS entry uses this any more;
   * the union member is retained only so the audit-only facade in
   * `features/mcp/main/mcp/ws-app-settings-api.ts` still type-checks its dead
   * `definition.source === 'electron-store'` branch. Retire the tombstone
   * together with that facade (B6).
   */
  | 'electron-store'
  | 'local-storage'
  /** Daemon settings catalog (PROTOCOL §5.12) — read via `appClient.settings.get`. */
  | 'daemon-settings'
  | 'augment-settings'
  | 'redux'
  | 'static';

export type AppSettingApplyPlan =
  | { kind: 'redux-action'; action: string }
  /**
   * Write through the daemon settings catalog (PROTOCOL §5.12). `path` is the
   * daemon setting path; when `valuePath` is set the write is a read-merge-
   * write on the object at `path` (used for sub-keys of `providers.paths`).
   */
  | { kind: 'daemon-settings-update'; path: string; valuePath?: string }
  /** Write to renderer `localStorage` under `key` (FE-only prefs). */
  | { kind: 'local-storage-set'; key: string }
  | { kind: 'user-mcp-settings'; key: 'mcpServers' }
  | { kind: 'read-only' };

export interface AppSettingDefinition {
  path: string;
  label: string;
  description: string;
  category: string;
  type: AppSettingValueType;
  source: AppSettingSource;
  defaultValue?: unknown;
  nullable?: boolean;
  nullLabel?: string;
  enumValues?: readonly string[];
  enumLabels?: Readonly<Record<string, string>>;
  min?: number;
  max?: number;
  storageKey?: string;
  storeName?: string;
  valuePath?: string;
  apply: AppSettingApplyPlan;
  sensitive?: boolean;
}

export interface AppSettingChange {
  path: string;
  value: unknown;
  reason?: string;
}

const THEME_PRESET_OPTIONS_DESCRIPTION = THEME_PRESET_MANIFEST.map(
  ({ id, label }) => `${label} (${id})`,
).join(', ');

const THEME_PRESET_ENUM_LABELS = Object.fromEntries(
  THEME_PRESET_MANIFEST.map(({ id, label }) => [id, label]),
);

function compactJsonSnippet(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (!json) return String(value);
    return json.length > 120 ? `${json.slice(0, 117)}…` : json;
  } catch {
    return String(value);
  }
}

export function formatSettingValue(definition: AppSettingDefinition, value: unknown): string {
  if (value === null || value === undefined || value === '')
    return definition.nullLabel ?? '(none)';
  if (definition.type === 'enum' && typeof value === 'string') {
    return definition.enumLabels?.[value] ?? value;
  }
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return compactJsonSnippet(value);
}

export const APP_SETTING_DEFINITIONS: readonly AppSettingDefinition[] = [
  {
    path: 'preferences.betaUpdatesEnabled',
    label: 'Beta updates',
    description: 'Whether beta update notifications are enabled.',
    category: 'preferences',
    type: 'boolean',
    source: 'redux',
    defaultValue: false,
    apply: { kind: 'redux-action', action: 'userPreferences/setBetaUpdatesEnabled' },
  },
  {
    path: 'preferences.spellcheckEnabled',
    label: 'Notes spellcheck',
    description: 'Whether spellcheck is enabled in note editors.',
    category: 'preferences',
    type: 'boolean',
    source: 'local-storage',
    storageKey: 'note-spellcheck-settings',
    valuePath: 'enabled',
    defaultValue: false,
    apply: { kind: 'redux-action', action: 'userPreferences/setSpellcheckEnabled' },
  },
  {
    path: 'workspaceList.showArchived',
    label: 'Show archived workspaces',
    description: 'Whether archived workspaces are shown in workspace lists.',
    category: 'workspace',
    type: 'boolean',
    source: 'local-storage',
    storageKey: 'workspace-list:showArchived',
    defaultValue: false,
    apply: { kind: 'redux-action', action: 'userPreferences/setShowArchived' },
  },
  {
    path: 'workspaceList.groupByRepo',
    label: 'Group workspaces by repo',
    description: 'Whether workspace lists group workspaces by repository.',
    category: 'workspace',
    type: 'boolean',
    source: 'local-storage',
    storageKey: 'workspace-list:groupByRepo',
    defaultValue: true,
    apply: { kind: 'redux-action', action: 'userPreferences/setGroupByRepo' },
  },
  {
    path: 'providers.completedSetup',
    label: 'Provider setup completed',
    description: 'Whether the provider setup checklist has been completed.',
    category: 'accounts',
    type: 'boolean',
    source: 'local-storage',
    storageKey: 'workspace-list:completedProviderSetup',
    defaultValue: false,
    apply: { kind: 'redux-action', action: 'userPreferences/setHasCompletedProviderSetup' },
  },
  {
    path: 'preferences.language',
    label: 'Language',
    description:
      'Display language for the app UI. "system" follows the OS locale; otherwise a BCP-47 tag of an available message catalog.',
    category: 'preferences',
    type: 'enum',
    // Catalog-driven: options come from the compiled Paraglide catalogs, so
    // new locales added to messages/ appear here automatically.
    enumValues: [SYSTEM_LANGUAGE_PREFERENCE, ...locales],
    enumLabels: { [SYSTEM_LANGUAGE_PREFERENCE]: 'System' },
    source: 'local-storage',
    storageKey: 'language-preference',
    defaultValue: SYSTEM_LANGUAGE_PREFERENCE,
    apply: { kind: 'redux-action', action: 'userPreferences/setLanguagePreference' },
  },
  {
    path: 'theme.preference',
    label: 'Theme preference',
    description: 'Light, dark, or system theme preference.',
    category: 'theme',
    type: 'enum',
    enumValues: ['light', 'dark', 'system'],
    enumLabels: { light: 'Light', dark: 'Dark', system: 'System' },
    source: 'local-storage',
    storageKey: 'theme',
    defaultValue: 'system',
    apply: { kind: 'redux-action', action: 'theme/requestThemePreferenceChange' },
  },
  {
    path: 'theme.activePresetId',
    label: 'Theme preset',
    description: `Active built-in color theme preset ID. Available presets: ${THEME_PRESET_OPTIONS_DESCRIPTION}.`,
    category: 'theme',
    type: 'enum',
    enumValues: THEME_PRESET_IDS,
    enumLabels: THEME_PRESET_ENUM_LABELS,
    source: 'local-storage',
    storageKey: 'theme-preset-id',
    defaultValue: null,
    nullable: true,
    nullLabel: 'Default',
    apply: { kind: 'redux-action', action: 'theme/selectThemePreset' },
  },
  {
    path: 'model.default',
    label: 'Default model',
    description: 'Default model used by the model picker for new chats.',
    category: 'agents',
    type: 'string',
    source: 'local-storage',
    storageKey: 'workspaces-selected-model',
    defaultValue: '',
    apply: { kind: 'redux-action', action: 'model/selectModel' },
  },
  {
    path: 'model.providerDefaults',
    label: 'Per-provider default models',
    description: 'Remembered selected model for each coding-agent provider.',
    category: 'agents',
    type: 'object',
    source: 'local-storage',
    storageKey: 'workspaces-provider-models',
    defaultValue: {},
    apply: { kind: 'read-only' },
  },
  {
    path: 'model.defaultReasoningEffort',
    label: 'Default reasoning effort',
    description:
      'Reasoning-effort level applied to new agents that resolve their model from the default-model setting. Empty means unset (the model default).',
    category: 'agents',
    type: 'string',
    source: 'daemon-settings',
    storageKey: 'model.defaultReasoningEffort',
    defaultValue: '',
    apply: { kind: 'daemon-settings-update', path: 'model.defaultReasoningEffort' },
  },
  {
    path: 'model.pickerCollapsedGroups',
    label: 'Collapsed model picker groups',
    description: 'Model picker groups the user has collapsed.',
    category: 'agents',
    type: 'array',
    source: 'local-storage',
    storageKey: 'model-picker-collapsed-groups',
    defaultValue: [],
    apply: { kind: 'read-only' },
  },
  {
    path: 'specialists.default',
    label: 'Default specialist',
    description: 'Last submitted workspace initializer specialist selection.',
    category: 'agents',
    type: 'object',
    source: 'local-storage',
    storageKey: 'workspace-initializer-last-agent',
    defaultValue: null,
    apply: { kind: 'read-only' },
  },
  {
    path: 'providers.active',
    label: 'Active coding agent',
    description: 'Default provider/coding agent for new work.',
    category: 'accounts',
    type: 'string',
    source: 'local-storage',
    storageKey: 'workspaces-active-provider',
    defaultValue: 'auggie',
    apply: { kind: 'redux-action', action: 'providerSettings/setActiveProvider' },
  },
  {
    path: 'providers.enabled',
    label: 'Enabled coding agents',
    description: 'Per-provider enabled/disabled settings.',
    category: 'accounts',
    type: 'object',
    source: 'local-storage',
    storageKey: 'additional-agents-settings',
    defaultValue: {},
    apply: { kind: 'redux-action', action: 'providerSettings/setProviderEnabled' },
  },
  {
    path: 'providers.paths.auggie',
    label: 'Auggie CLI path',
    description: 'Override path for the Auggie provider executable.',
    category: 'accounts',
    type: 'string',
    source: 'daemon-settings',
    storageKey: 'context.auggiePath',
    defaultValue: '',
    apply: { kind: 'daemon-settings-update', path: 'context.auggiePath' },
  },
  {
    path: 'providers.paths.claude-code',
    label: 'Claude Code CLI path',
    description: 'Override path for the Claude Code provider executable.',
    category: 'accounts',
    type: 'string',
    source: 'daemon-settings',
    storageKey: 'providers.paths',
    valuePath: 'claude-code',
    defaultValue: '',
    apply: { kind: 'daemon-settings-update', path: 'providers.paths', valuePath: 'claude-code' },
  },
  {
    path: 'providers.paths.codex',
    label: 'Codex CLI path',
    description: 'Override path for the Codex provider executable.',
    category: 'accounts',
    type: 'string',
    source: 'daemon-settings',
    storageKey: 'providers.paths',
    valuePath: 'codex',
    defaultValue: '',
    apply: { kind: 'daemon-settings-update', path: 'providers.paths', valuePath: 'codex' },
  },
  {
    path: 'workspace.branchPrefix',
    label: 'Branch prefix',
    description: 'Prefix added to newly-created workspace branches.',
    category: 'workspace',
    type: 'string',
    source: 'daemon-settings',
    storageKey: 'workspace.branchPrefix',
    defaultValue: '',
    apply: { kind: 'daemon-settings-update', path: 'workspace.branchPrefix' },
  },
  {
    path: 'workspace.worktreesLocation',
    label: 'Worktrees location',
    description: 'Custom parent directory for workspace worktrees.',
    category: 'workspace',
    type: 'string',
    source: 'daemon-settings',
    storageKey: 'workspace.worktreesLocation',
    defaultValue: '',
    apply: { kind: 'daemon-settings-update', path: 'workspace.worktreesLocation' },
  },
  {
    path: 'workspace.sshKeyPath',
    label: 'SSH key path',
    description: 'Optional SSH private key path used by Git operations.',
    category: 'workspace',
    type: 'string',
    source: 'daemon-settings',
    storageKey: 'workspace.sshKeyPath',
    defaultValue: '',
    sensitive: true,
    apply: { kind: 'daemon-settings-update', path: 'workspace.sshKeyPath' },
  },
  {
    path: 'workspace.defaultShell',
    label: 'Default shell',
    description: 'Default shell used for terminals.',
    category: 'workspace',
    type: 'string',
    source: 'daemon-settings',
    storageKey: 'workspace.defaultShell',
    defaultValue: 'auto',
    apply: { kind: 'daemon-settings-update', path: 'workspace.defaultShell' },
  },
  {
    path: 'workspace.autoCommit',
    label: 'Auto-commit',
    description: 'Global default for workspace auto-commit behavior.',
    category: 'workspace',
    type: 'boolean',
    source: 'daemon-settings',
    storageKey: 'git.autoCommit',
    defaultValue: true,
    apply: { kind: 'daemon-settings-update', path: 'git.autoCommit' },
  },
  {
    path: 'notifications.enabled',
    label: 'Notifications enabled',
    description: 'Whether app notifications are enabled.',
    category: 'notifications',
    type: 'boolean',
    source: 'daemon-settings',
    storageKey: 'notifications.enabled',
    defaultValue: true,
    apply: { kind: 'redux-action', action: 'notificationSettings/setNotificationEnabled' },
  },
  {
    path: 'notifications.soundEnabled',
    label: 'Notification sounds',
    description: 'Whether notification sounds are enabled.',
    category: 'notifications',
    type: 'boolean',
    source: 'daemon-settings',
    storageKey: 'notifications.soundEnabled',
    defaultValue: true,
    apply: { kind: 'redux-action', action: 'notificationSettings/setSoundEnabled' },
  },
  {
    path: 'notifications.soundOnlyWhenUnfocused',
    label: 'Sound only when unfocused',
    description: 'Only play notification sounds when the app is unfocused.',
    category: 'notifications',
    type: 'boolean',
    source: 'daemon-settings',
    storageKey: 'notifications.soundOnlyWhenUnfocused',
    defaultValue: true,
    apply: { kind: 'redux-action', action: 'notificationSettings/setSoundOnlyWhenUnfocused' },
  },
  {
    path: 'notifications.volume',
    label: 'Notification volume',
    description: 'Notification sound volume from 0 to 1.',
    category: 'notifications',
    type: 'number',
    min: 0,
    max: 1,
    source: 'daemon-settings',
    storageKey: 'notifications.volume',
    defaultValue: 0.5,
    apply: { kind: 'redux-action', action: 'notificationSettings/setVolume' },
  },
  {
    path: 'mcp.enableUserServers',
    label: 'User MCP servers enabled',
    description: 'Whether custom user MCP servers from ~/.augment/settings.json are enabled.',
    category: 'mcp',
    type: 'boolean',
    source: 'daemon-settings',
    storageKey: 'mcp.enableUserServers',
    defaultValue: true,
    apply: { kind: 'daemon-settings-update', path: 'mcp.enableUserServers' },
  },
  {
    path: 'mcp.disabledServers',
    label: 'Disabled MCP servers',
    description: 'Global list of disabled MCP server names.',
    category: 'mcp',
    type: 'array',
    source: 'daemon-settings',
    storageKey: 'mcp.disabledServers',
    defaultValue: [],
    apply: { kind: 'daemon-settings-update', path: 'mcp.disabledServers' },
  },
  {
    path: 'mcp.servers',
    label: 'MCP servers',
    description: 'Configured MCP servers from ~/.augment/settings.json.',
    category: 'mcp',
    type: 'object',
    source: 'augment-settings',
    storageKey: 'mcpServers',
    defaultValue: {},
    sensitive: true,
    apply: { kind: 'user-mcp-settings', key: 'mcpServers' },
  },
  {
    path: 'backgroundAgents.defaultModel',
    label: 'Default quick action model',
    description: 'Default model for quick/background agents.',
    category: 'agents',
    type: 'string',
    source: 'local-storage',
    storageKey: 'workspaces-background-agent-settings',
    valuePath: 'defaultModel',
    defaultValue: '',
    apply: { kind: 'redux-action', action: 'backgroundAgentSettings/setDefaultModel' },
  },
  {
    path: 'backgroundAgents.typeOverrides',
    label: 'Quick action model overrides',
    description: 'Per-quick-action model overrides.',
    category: 'agents',
    type: 'object',
    source: 'local-storage',
    storageKey: 'workspaces-background-agent-settings',
    valuePath: 'typeOverrides',
    defaultValue: { commit: '', pr: '', review: '', fast: '' },
    apply: { kind: 'redux-action', action: 'backgroundAgentSettings/setTypeOverride' },
  },
  {
    path: 'backgroundAgents.providerSettings',
    label: 'Per-provider quick action settings',
    description: 'Cached quick/background agent settings by provider ID.',
    category: 'agents',
    type: 'object',
    source: 'local-storage',
    storageKey: 'workspaces-bg-agent-settings-per-provider',
    defaultValue: {},
    apply: { kind: 'read-only' },
  },
  {
    path: 'fonts.agent',
    label: 'Agent font',
    description: 'Font style for agent messages.',
    category: 'fonts',
    type: 'enum',
    enumValues: ['sans', 'monospace'],
    source: 'local-storage',
    storageKey: 'agent-font-settings',
    valuePath: 'fontStyle',
    defaultValue: 'sans',
    apply: { kind: 'redux-action', action: 'fontSettings/setAgentFontStyle' },
  },
  {
    path: 'fonts.notes',
    label: 'Notes font',
    description: 'Font style for notes.',
    category: 'fonts',
    type: 'enum',
    enumValues: ['sans', 'monospace'],
    source: 'local-storage',
    storageKey: 'note-font-settings',
    valuePath: 'fontStyle',
    defaultValue: 'sans',
    apply: { kind: 'redux-action', action: 'fontSettings/setNoteFontStyle' },
  },
  {
    path: 'fonts.code',
    label: 'Code font',
    description: 'Font family for code editors.',
    category: 'fonts',
    type: 'string',
    source: 'local-storage',
    storageKey: 'code-font-settings',
    valuePath: 'fontFamily',
    defaultValue: 'system-default',
    apply: { kind: 'redux-action', action: 'fontSettings/setCodeFontFamily' },
  },
  {
    path: 'ui.editor',
    label: 'Editor view options',
    description: 'Code/diff editor wrapping, folding, side-by-side diff, and indicators.',
    category: 'per-feature',
    type: 'object',
    source: 'local-storage',
    storageKey: 'editor-settings',
    defaultValue: {
      lineWrapping: true,
      foldUnchanged: true,
      diffSideBySide: true,
      diffIndicators: true,
    },
    apply: { kind: 'redux-action', action: 'uiLayout/editorSettings' },
  },
  {
    path: 'ui.layout',
    label: 'Layout settings',
    description: 'Spaces sidebar width/collapse, tab pinning, and sidebar side.',
    category: 'per-feature',
    type: 'object',
    source: 'local-storage',
    storageKey: 'layout-settings',
    defaultValue: {
      spacesSidebarWidth: 200,
      spacesSidebarCollapsed: false,
      tabbedSidebarPinned: true,
      sidebarSide: 'left',
    },
    apply: { kind: 'redux-action', action: 'uiLayout/layoutSettings' },
  },
  {
    path: 'ui.workspaceLeftPanel.collapsed',
    label: 'Workspace left panel collapsed',
    description: 'Collapsed state for the workspace left panel.',
    category: 'per-feature',
    type: 'boolean',
    source: 'local-storage',
    storageKey: 'workspace-left-panel-collapsed',
    defaultValue: false,
    apply: { kind: 'redux-action', action: 'uiLayout/setCollapsed' },
  },
  {
    path: 'ui.workspaceLeftPanel.widthPercent',
    label: 'Workspace left panel width',
    description: 'Persisted workspace left panel width as a percent of window width.',
    category: 'per-feature',
    type: 'number',
    source: 'local-storage',
    storageKey: 'workspace-left-panel-width',
    defaultValue: null,
    apply: { kind: 'read-only' },
  },
  {
    path: 'ui.workspaceLeftPanel.expandedWidthPercent',
    label: 'Workspace left panel expanded width',
    description: 'Persisted expanded workspace left panel width as a percent of window width.',
    category: 'per-feature',
    type: 'number',
    source: 'local-storage',
    storageKey: 'workspace-left-panel-expanded-width',
    defaultValue: null,
    apply: { kind: 'read-only' },
  },
  {
    path: 'ui.bottomDock',
    label: 'Bottom dock settings',
    description: 'Bottom dock view mode, terminal selection, and height.',
    category: 'per-feature',
    type: 'object',
    source: 'local-storage',
    storageKey: 'bottom-dock-state',
    defaultValue: { viewMode: 'agents', activeTerminalId: null, height: 400 },
    apply: { kind: 'read-only' },
  },
  {
    path: 'ui.workspaceSidebarPanels',
    label: 'Workspace sidebar panels',
    description: 'Collapsed and height settings for workspace sidebar panels.',
    category: 'per-feature',
    type: 'object',
    source: 'local-storage',
    storageKey: 'vscode-resizable-panels',
    defaultValue: { collapsed: {}, heights: {} },
    apply: { kind: 'read-only' },
  },
  {
    path: 'openIn.defaultAction',
    label: 'Open In default action',
    description: 'Default action for Open In controls.',
    category: 'per-feature',
    type: 'string',
    source: 'local-storage',
    storageKey: 'open-combo-button-last-action',
    defaultValue: 'vscode',
    apply: { kind: 'redux-action', action: 'externalEditors/setOpenAction' },
  },
  {
    path: 'openIn.hiddenEditors',
    label: 'Hidden Open In editors',
    description: 'Editor IDs hidden from Open In menus.',
    category: 'per-feature',
    type: 'array',
    source: 'local-storage',
    storageKey: 'legacy-settings:hiddenOpenInEditors',
    defaultValue: [],
    apply: { kind: 'local-storage-set', key: 'legacy-settings:hiddenOpenInEditors' },
  },
  {
    path: 'rtk.enabled',
    label: 'RTK enabled',
    description: 'Whether RTK helper behavior is enabled.',
    category: 'per-feature',
    type: 'boolean',
    source: 'daemon-settings',
    storageKey: 'rtk.enabled',
    defaultValue: false,
    apply: { kind: 'daemon-settings-update', path: 'rtk.enabled' },
  },
  {
    path: 'linear.issueFilter',
    label: 'Linear issue filter',
    description: 'Saved Linear issue filter used by integrations.',
    category: 'accounts',
    type: 'object',
    source: 'local-storage',
    storageKey: 'legacy-settings:linearIssueFilter',
    defaultValue: null,
    apply: { kind: 'local-storage-set', key: 'legacy-settings:linearIssueFilter' },
  },
  {
    path: 'accounts.sentry',
    label: 'Sentry account',
    description: 'Persisted Sentry account status. API tokens are never exposed.',
    category: 'accounts',
    type: 'status',
    source: 'daemon-settings',
    storageKey: 'accounts.sentry',
    defaultValue: null,
    sensitive: true,
    apply: { kind: 'read-only' },
  },
  {
    path: 'activityLog.presets',
    label: 'Activity log presets',
    description: 'Saved activity log filter presets.',
    category: 'per-feature',
    type: 'array',
    source: 'local-storage',
    storageKey: 'activityLogPresets',
    defaultValue: [],
    apply: { kind: 'read-only' },
  },
  {
    path: 'keybindings.shortcuts',
    label: 'Keyboard shortcuts',
    description: 'Built-in keyboard shortcut catalog. Custom keybindings are not persisted yet.',
    category: 'keybindings',
    type: 'readonly',
    source: 'static',
    defaultValue: 'Built-in shortcuts are available in the shortcuts cheat sheet.',
    apply: { kind: 'read-only' },
  },
] as const;

export function findAppSettingDefinition(path: string): AppSettingDefinition | undefined {
  return APP_SETTING_DEFINITIONS.find((definition) => definition.path === path);
}
