import { faCog } from '@fortawesome/free-solid-svg-icons';
import type { SettingsTab } from '$lib/components/patterns/settings/types';
import { m } from '$shared/paraglide/messages.js';

// Reuse the settings sidebar labels; aliases are search metadata, never displayed.
const SETTINGS_PAGES = {
  'agent-behavior': {
    get label() {
      return m.settings_sidebar_agentBehavior_label();
    },
    searchText: 'instructions system prompt agent behavior defaults rules',
  },
  providers: {
    get label() {
      return m.settings_sidebar_providers_label();
    },
    searchText: 'providers models coding cli default model quick actions background agents',
  },
  connections: {
    get label() {
      return m.settings_sidebar_connections_label();
    },
    searchText: 'connections integrations accounts Linear GitHub GitLab Sentry MCP servers',
  },
  'token-savings': {
    get label() {
      return m.settings_sidebar_tokenSavings_label();
    },
    searchText:
      'token savings rtk cli optimization tool output retention toon agent features tool approvals',
  },
  devices: {
    get label() {
      return m.settings_sidebar_devices_label();
    },
    searchText: 'machines devices remote hosts backend sync',
  },
  mobile: {
    get label() {
      return m.settings_sidebar_mobile_label();
    },
    searchText: 'mobile iPhone pairing remote access websocket api',
  },
  collaboration: {
    get label() {
      return m.settings_sidebar_guestSessions_label();
    },
    searchText: 'collaboration multiplayer sharing guests membership joined hosts',
  },
  display: {
    get label() {
      return m.settings_sidebar_display_label();
    },
    searchText: 'appearance display theme color fonts language layout width',
  },
  'app-behavior': {
    get label() {
      return m.settings_sidebar_appBehavior_label();
    },
    searchText: 'general app behavior notifications updates licenses open in github links',
  },
  performance: {
    get label() {
      return m.settings_sidebar_performance_label();
    },
    searchText:
      'performance battery motion animations aurora translucent agent backend memory heap concurrent idle',
  },
  input: {
    get label() {
      return m.settings_sidebar_input_label();
    },
    searchText: 'input keyboard shortcuts voice dictation microphone',
  },
  passkeys: {
    get label() {
      return m.settings_sidebar_passkeys_label();
    },
    searchText: 'passkeys webauthn security keys browser sign in device pin',
  },
  setup: {
    get label() {
      return m.settings_sidebar_setup_label();
    },
    searchText: 'workspace setup git shell terminal',
  },
  advanced: {
    get label() {
      return m.settings_sidebar_advanced_label();
    },
    searchText: 'advanced labs experimental connection data import reset',
  },
  specialists: {
    get label() {
      return m.settings_sidebar_specialists_label();
    },
    searchText: 'specialists custom agents roles',
  },
} satisfies Record<SettingsTab, { label: string; searchText: string }>;

export function getSettingsPaletteCommands({
  isCollaboratorOnlyClient,
  multiplayerEnabled,
  devicePasskeysAvailable = false,
}: {
  isCollaboratorOnlyClient: boolean;
  multiplayerEnabled: boolean;
  devicePasskeysAvailable?: boolean;
}) {
  // Match the settings page's hidden tabs, including its safe boot-time defaults.
  return (Object.keys(SETTINGS_PAGES) as SettingsTab[])
    .filter(
      (tab) =>
        !(isCollaboratorOnlyClient && (tab === 'providers' || tab === 'connections')) &&
        !(tab === 'collaboration' && !multiplayerEnabled) &&
        !(tab === 'passkeys' && !devicePasskeysAvailable),
    )
    .map((tab) => ({
      id: `settings-${tab}`,
      settingsTab: tab,
      get label() {
        return SETTINGS_PAGES[tab].label;
      },
      get description() {
        return m.settings_page_title();
      },
      get searchText() {
        return `${m.settings_page_title()} ${SETTINGS_PAGES[tab].searchText}`;
      },
      icon: faCog,
    }));
}
