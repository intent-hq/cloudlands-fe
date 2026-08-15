export const SETTINGS_TABS = [
  {
    id: 'accounts',
    label: 'Providers',
    heading: '',
    stateOwners: ['Redux providerSettings', 'Redux auth', 'local availability'],
    saveModes: ['immediate'],
    states: ['loading', 'installed', 'missing', 'auth-required', 'active', 'disabled', 'error'],
  },
  {
    id: 'agents',
    label: 'Agents',
    heading: '',
    stateOwners: ['Redux specialists', 'Redux model', 'Redux providerSettings', 'local draft'],
    saveModes: ['autosave', 'explicit destructive confirmation'],
    states: [
      'empty',
      'global-prompt',
      'file-specialist',
      'validation',
      'saving',
      'error',
      'confirmation',
    ],
  },
  {
    id: 'setup',
    label: 'Tools',
    heading: '',
    stateOwners: ['daemon settings', 'Redux MCP', 'Redux externalEditors', 'local pairing'],
    saveModes: ['immediate', 'blur-or-enter', 'explicit'],
    states: ['loading', 'empty', 'validation', 'disabled', 'saving', 'success', 'error'],
  },
  {
    id: 'fonts-colors',
    label: 'Appearance',
    heading: 'Appearance',
    stateOwners: ['Redux theme', 'Redux userPreferences'],
    saveModes: ['immediate'],
    states: ['default', 'selected', 'imported', 'validation', 'long-content', 'compact'],
  },
  {
    id: 'notifications',
    label: 'General',
    heading: 'Notifications',
    stateOwners: ['Redux notifications'],
    saveModes: ['immediate'],
    states: ['default', 'disabled', 'success', 'error'],
  },
  {
    id: 'general',
    label: 'General',
    heading: 'Updates',
    stateOwners: ['Redux autoUpdate'],
    saveModes: ['immediate', 'confirmation'],
    states: ['empty', 'installed', 'update-available', 'success', 'confirmation', 'developer'],
  },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];
export type SettingsTheme = 'light' | 'dark';
export type SettingsViewport = 'desktop' | 'compact';

const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  compact: { width: 900, height: 760 },
} as const;

const SETTINGS_TAB_QUERY: Partial<Record<SettingsTabId, string>> = {
  accounts: 'providers',
  setup: 'tools',
  'fonts-colors': 'appearance',
  notifications: 'general',
};

const CAPTURE_CASES = [
  ['accounts', 'light', 'desktop', 'loading', 'Redux providerSettings', 'immediate'],
  ['accounts', 'light', 'compact', 'error', 'local availability', 'immediate'],
  ['accounts', 'dark', 'desktop', 'disabled', 'Redux providerSettings', 'immediate'],
  ['accounts', 'dark', 'compact', 'success', 'Redux auth', 'immediate'],
  ['agents', 'light', 'desktop', 'empty', 'Redux specialists', 'autosave'],
  ['agents', 'light', 'compact', 'validation', 'local draft', 'autosave'],
  ['agents', 'dark', 'desktop', 'confirmation', 'Redux model', 'explicit destructive confirmation'],
  [
    'agents',
    'dark',
    'compact',
    'success',
    'Redux providerSettings',
    'explicit destructive confirmation',
  ],
  ['setup', 'light', 'desktop', 'loading', 'daemon settings', 'immediate'],
  ['setup', 'light', 'compact', 'disabled', 'Redux externalEditors', 'blur-or-enter'],
  ['setup', 'dark', 'desktop', 'error', 'Redux MCP', 'immediate'],
  ['setup', 'dark', 'compact', 'success', 'local pairing', 'explicit'],
  ['fonts-colors', 'light', 'desktop', 'disabled', 'Redux theme', 'immediate'],
  ['fonts-colors', 'light', 'compact', 'validation', 'Redux userPreferences', 'immediate'],
  ['fonts-colors', 'dark', 'desktop', 'success', 'Redux theme', 'immediate'],
  ['fonts-colors', 'dark', 'compact', 'empty', 'Redux userPreferences', 'immediate'],
  ['notifications', 'light', 'desktop', 'disabled', 'Redux notifications', 'immediate'],
  ['notifications', 'light', 'compact', 'disabled', 'Redux notifications', 'immediate'],
  ['notifications', 'dark', 'desktop', 'success', 'Redux notifications', 'immediate'],
  ['notifications', 'dark', 'compact', 'disabled', 'Redux notifications', 'immediate'],
  ['general', 'light', 'desktop', 'empty', 'Redux autoUpdate', 'immediate'],
  ['general', 'light', 'compact', 'confirmation', 'Redux autoUpdate', 'confirmation'],
  ['general', 'dark', 'desktop', 'success', 'Redux autoUpdate', 'immediate'],
  ['general', 'dark', 'compact', 'loading', 'Redux autoUpdate', 'confirmation'],
] as const;

export const SETTINGS_CAPTURE_FIXTURES = CAPTURE_CASES.map(
  ([tabId, theme, viewport, state, stateOwner, saveMode]) => {
    const tab = SETTINGS_TABS.find(({ id }) => id === tabId)!;
    return {
      id: `${tabId}-${theme}-${viewport}`,
      tab: tabId,
      label: tab.label,
      heading: tab.heading,
      theme,
      viewport,
      ...VIEWPORTS[viewport],
      url: `/settings?tab=${SETTINGS_TAB_QUERY[tabId] ?? tabId}`,
      state,
      stateOwner,
      saveMode,
    };
  },
);

export type SettingsCaptureFixture = (typeof SETTINGS_CAPTURE_FIXTURES)[number];
export type SettingsFixtureState = SettingsCaptureFixture['state'];
export type SettingsFixtureTransition = 'add' | 'retry' | 'confirm' | 'save';
export const SETTINGS_STATE_FIXTURE_CONTEXT = 'settings-state-fixture-context';

export type SettingsOwnerSnapshot = {
  state: SettingsFixtureState;
  value: string;
};

export type SettingsStateFixtureContext = {
  fixture: SettingsCaptureFixture;
  catalogSize: number;
  ownerSource: 'redux' | 'router' | 'local';
  owner: SettingsOwnerSnapshot;
  transition: (intent: SettingsFixtureTransition) => Promise<SettingsOwnerSnapshot>;
};

export function createSettingsFixtureUpdate(value: string) {
  const change = { path: 'providers.active', value };
  return {
    request: { method: 'settings.update', params: { changes: [change] } },
    response: { applied: [change] },
  } as const;
}

export const SETTINGS_PROTOCOL_FIXTURES = {
  list: {
    request: { method: 'settings.list', params: undefined },
    response: {
      settings: [
        {
          path: 'providers.active',
          label: 'Active provider',
          description: '',
          category: 'providers',
          type: 'string',
          defaultValue: 'auggie',
          value: 'codex',
        },
        {
          path: 'providers.enabled',
          label: 'Enabled providers',
          description: '',
          category: 'providers',
          type: 'object',
          defaultValue: {},
          value: { codex: true },
        },
      ],
    },
  },
  maxConcurrent: {
    request: { method: 'settings.get', params: { path: 'agents.maxConcurrent' } },
    response: {
      path: 'agents.maxConcurrent',
      value: 12,
      definition: {
        path: 'agents.maxConcurrent',
        label: 'Max concurrent agents',
        description: '',
        category: 'agents',
        type: 'number',
        min: 0,
        max: 200,
        defaultValue: 0,
      },
    },
  },
  flushQueuedMessages: {
    request: { method: 'settings.get', params: { path: 'agents.flushQueuedMessages' } },
    response: {
      path: 'agents.flushQueuedMessages',
      value: 'systemOnly',
      definition: {
        path: 'agents.flushQueuedMessages',
        label: 'Flush queued messages',
        description: '',
        category: 'agents',
        type: 'enum',
        enumValues: ['all', 'systemOnly', 'off'],
        defaultValue: 'all',
      },
    },
  },
  // The budget's `max` is the daemon's detected total physical memory, so it
  // varies per machine; the fixture pins the shape, not a constant the FE is
  // allowed to assume (48 GB here — deliberately not a value worth hardcoding).
  memoryBudgetMb: {
    request: { method: 'settings.get', params: { path: 'agents.memoryBudgetMb' } },
    response: {
      path: 'agents.memoryBudgetMb',
      value: 0,
      definition: {
        path: 'agents.memoryBudgetMb',
        label: 'Agent memory budget (MB)',
        description: '',
        category: 'agents',
        type: 'number',
        min: 0,
        max: 49152,
        defaultValue: 0,
      },
    },
  },
  idleReapMinutes: {
    request: { method: 'settings.get', params: { path: 'agents.idleReapMinutes' } },
    response: {
      path: 'agents.idleReapMinutes',
      value: 10,
      definition: {
        path: 'agents.idleReapMinutes',
        label: 'Idle reap minutes',
        description: '',
        category: 'agents',
        type: 'number',
        min: 0,
        defaultValue: 10,
      },
    },
  },
  resetMaxConcurrent: {
    request: { method: 'settings.reset', params: { path: 'agents.maxConcurrent' } },
    response: { path: 'agents.maxConcurrent', value: 0 },
  },
} as const;

// The settings.list/update methods are documented, but these shipped setting
// paths are not yet enumerated by either authoritative PROTOCOL copy.
export const SHIPPED_WEBSOCKET_SETTING_FIXTURES = {
  list: {
    request: { method: 'settings.list', params: undefined },
    response: {
      settings: [
        {
          path: 'server.wsApi.enabled',
          label: 'WebSocket API',
          description: 'Allow authenticated local WebSocket clients.',
          category: 'server',
          type: 'boolean',
          defaultValue: false,
          value: false,
        },
        {
          path: 'server.wsApi.port',
          label: 'WebSocket port',
          description: 'Port used by the local WebSocket API.',
          category: 'server',
          type: 'number',
          min: 1024,
          max: 65535,
          defaultValue: 5181,
          value: 5181,
        },
      ],
    },
  },
} as const;

// Shipped FE/daemon seam, intentionally separate from SETTINGS_PROTOCOL_FIXTURES:
// neither authoritative PROTOCOL copy documents this server method yet.
export const UNDOCUMENTED_SERVER_FIXTURES = {
  pairingInfo: {
    request: { method: 'server.pairingInfo', params: undefined },
    response: {
      token: 'fixture-token',
      certFingerprint: 'AA:BB:CC',
      port: 5181,
      path: '/ws',
      localIps: ['192.0.2.10'],
      hostname: 'fixture-host',
    },
  },
} as const;

export const REQUIRED_SETTINGS_STATES = [
  'loading',
  'empty',
  'validation',
  'error',
  'success',
  'disabled',
  'confirmation',
] as const;
