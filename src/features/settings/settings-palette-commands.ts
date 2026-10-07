import { faCog } from '@fortawesome/free-solid-svg-icons';
import type { SettingsTab } from '$lib/components/patterns/settings/types';
import { m } from '$shared/paraglide/messages.js';

// Reuse the settings sidebar labels; aliases are search metadata, never displayed.
const SETTINGS_PAGES = {
  'agent-behavior': {
    get label() {
      return m.settings_sidebar_agentBehavior_label();
    },
    searchText: 'agent behavior defaults instructions rules features',
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
    searchText: 'appearance display theme color fonts language transparency',
  },
  'app-behavior': {
    get label() {
      return m.settings_sidebar_appBehavior_label();
    },
    searchText: 'general app behavior notifications updates licenses open in github links',
  },
  input: {
    get label() {
      return m.settings_sidebar_input_label();
    },
    searchText: 'input keyboard shortcuts voice dictation microphone',
  },
  setup: {
    get label() {
      return m.settings_sidebar_setup_label();
    },
    searchText: 'workspace setup git shell terminal cli optimization rtk',
  },
  advanced: {
    get label() {
      return m.settings_sidebar_advanced_label();
    },
    searchText: 'advanced tool output retention agent backend connection data import reset',
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
}: {
  isCollaboratorOnlyClient: boolean;
  multiplayerEnabled: boolean;
}) {
  // Match the settings page's hidden tabs, including its safe boot-time defaults.
  return (Object.keys(SETTINGS_PAGES) as SettingsTab[])
    .filter(
      (tab) =>
        !(isCollaboratorOnlyClient && (tab === 'providers' || tab === 'connections')) &&
        !(tab === 'collaboration' && !multiplayerEnabled),
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
