export const SETTINGS_TABS = [
  {
    id: 'display',
    label: 'Display',
    heading: 'Appearance',
    stateOwners: ['Redux theme', 'Redux userPreferences'],
    saveModes: ['immediate'],
    states: ['default', 'selected', 'validation', 'success', 'disabled'],
  },
  {
    id: 'app-behavior',
    label: 'App Behavior',
    heading: 'Updates',
    stateOwners: ['Redux autoUpdate', 'Redux notifications'],
    saveModes: ['immediate', 'confirmation'],
    states: ['empty', 'update-available', 'success', 'error', 'disabled', 'confirmation'],
  },
  {
    id: 'agent-behavior',
    label: 'Agent Behavior',
    heading: 'Agent Features',
    stateOwners: ['Redux specialists', 'Redux model', 'Redux providerSettings', 'local draft'],
    saveModes: ['autosave', 'explicit destructive confirmation'],
    states: ['empty', 'global-prompt', 'validation', 'saving', 'error', 'confirmation'],
  },
  {
    id: 'providers',
    label: 'Providers',
    heading: '',
    stateOwners: ['Redux providerSettings', 'Redux auth', 'local availability'],
    saveModes: ['immediate'],
    states: ['loading', 'installed', 'missing', 'auth-required', 'active', 'disabled', 'error'],
  },
  {
    id: 'connections',
    label: 'Connections',
    heading: 'Accounts',
    stateOwners: ['Redux auth', 'Redux MCP', 'local availability'],
    saveModes: ['immediate', 'explicit'],
    states: ['loading', 'empty', 'success', 'error'],
  },
  {
    id: 'setup',
    label: 'Setup',
    heading: 'Git',
    stateOwners: ['daemon settings', 'Redux MCP', 'Redux externalEditors', 'local pairing'],
    saveModes: ['immediate', 'blur-or-enter', 'explicit'],
    states: ['loading', 'empty', 'validation', 'disabled', 'saving', 'success', 'error'],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    heading: 'Agent Backend',
    stateOwners: ['daemon settings', 'local pairing'],
    saveModes: ['immediate', 'explicit'],
    states: ['loading', 'disabled', 'success', 'error'],
  },
  {
    id: 'input',
    label: 'Input',
    heading: 'Keyboard Shortcuts',
    stateOwners: ['Redux userPreferences', 'local draft'],
    saveModes: ['immediate', 'autosave'],
    states: ['default', 'validation', 'success', 'error'],
  },
] as const;

const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  compact: { width: 900, height: 760 },
} as const;

const CAPTURE_CASES = [
  ['display', 'light', 'desktop', 'default', 'Redux theme', 'immediate'],
  ['display', 'light', 'compact', 'validation', 'Redux userPreferences', 'immediate'],
  ['display', 'dark', 'desktop', 'success', 'Redux theme', 'immediate'],
  ['display', 'dark', 'compact', 'disabled', 'Redux userPreferences', 'immediate'],
  ['app-behavior', 'light', 'desktop', 'empty', 'Redux autoUpdate', 'immediate'],
  ['app-behavior', 'light', 'compact', 'confirmation', 'Redux autoUpdate', 'confirmation'],
  ['app-behavior', 'dark', 'desktop', 'success', 'Redux notifications', 'immediate'],
  ['app-behavior', 'dark', 'compact', 'disabled', 'Redux notifications', 'immediate'],
  ['agent-behavior', 'light', 'desktop', 'empty', 'Redux specialists', 'autosave'],
  ['agent-behavior', 'light', 'compact', 'validation', 'local draft', 'autosave'],
  [
    'agent-behavior',
    'dark',
    'desktop',
    'confirmation',
    'Redux model',
    'explicit destructive confirmation',
  ],
  [
    'agent-behavior',
    'dark',
    'compact',
    'success',
    'Redux providerSettings',
    'explicit destructive confirmation',
  ],
  ['providers', 'light', 'desktop', 'loading', 'Redux providerSettings', 'immediate'],
  ['providers', 'light', 'compact', 'error', 'local availability', 'immediate'],
  ['providers', 'dark', 'desktop', 'disabled', 'Redux providerSettings', 'immediate'],
  ['providers', 'dark', 'compact', 'success', 'Redux auth', 'immediate'],
  ['connections', 'light', 'desktop', 'loading', 'Redux MCP', 'immediate'],
  ['connections', 'light', 'compact', 'empty', 'Redux auth', 'explicit'],
  ['connections', 'dark', 'desktop', 'success', 'local availability', 'immediate'],
  ['connections', 'dark', 'compact', 'error', 'Redux MCP', 'explicit'],
  ['setup', 'light', 'desktop', 'loading', 'daemon settings', 'immediate'],
  ['setup', 'light', 'compact', 'disabled', 'Redux externalEditors', 'blur-or-enter'],
  ['setup', 'dark', 'desktop', 'error', 'Redux MCP', 'immediate'],
  ['setup', 'dark', 'compact', 'success', 'local pairing', 'explicit'],
  ['advanced', 'light', 'desktop', 'loading', 'daemon settings', 'immediate'],
  ['advanced', 'light', 'compact', 'disabled', 'local pairing', 'explicit'],
  ['advanced', 'dark', 'desktop', 'error', 'daemon settings', 'immediate'],
  ['advanced', 'dark', 'compact', 'success', 'local pairing', 'explicit'],
  ['input', 'light', 'desktop', 'default', 'Redux userPreferences', 'immediate'],
  ['input', 'light', 'compact', 'validation', 'local draft', 'autosave'],
  ['input', 'dark', 'desktop', 'success', 'Redux userPreferences', 'immediate'],
  ['input', 'dark', 'compact', 'error', 'local draft', 'autosave'],
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
      url: `/settings?tab=${tabId}`,
      state,
      stateOwner,
      saveMode,
    };
  },
);

export type SettingsCaptureFixture = (typeof SETTINGS_CAPTURE_FIXTURES)[number];
export type SettingsFixtureState = SettingsCaptureFixture['state'];
type SettingsFixtureTransition = 'add' | 'retry' | 'confirm' | 'save';
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
