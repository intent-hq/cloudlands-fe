import type { Component } from 'svelte';
import { m } from '$shared/paraglide/messages.js';
import CoinsIcon from 'phosphor-svelte/lib/CoinsIcon';
import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
import DeviceMobileIcon from 'phosphor-svelte/lib/DeviceMobileIcon';
import GaugeIcon from 'phosphor-svelte/lib/GaugeIcon';
import GearSixIcon from 'phosphor-svelte/lib/GearSixIcon';
import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
import KeyboardIcon from 'phosphor-svelte/lib/KeyboardIcon';
import KeyIcon from 'phosphor-svelte/lib/KeyIcon';
import PaintBrushIcon from 'phosphor-svelte/lib/PaintBrushIcon';
import PlugsConnectedIcon from 'phosphor-svelte/lib/PlugsConnectedIcon';
import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
import SlidersHorizontalIcon from 'phosphor-svelte/lib/SlidersHorizontalIcon';
import TerminalWindowIcon from 'phosphor-svelte/lib/TerminalWindowIcon';
import UsersIcon from 'phosphor-svelte/lib/UsersIcon';
import type { SettingsTab } from '$lib/components/patterns/settings/types';

interface SettingsNavItem {
  id: SettingsTab;
  icon: Component<Record<string, unknown>>;
  readonly label: string;
}

export interface SettingsNavGroup {
  id: string;
  readonly label: string;
  items: readonly SettingsNavItem[];
}

const primaryItems: readonly SettingsNavItem[] = [
  {
    id: 'providers',
    icon: TerminalWindowIcon,
    get label() {
      return m.settings_sidebar_providers_label();
    },
  },
  {
    id: 'agent-behavior',
    icon: RobotIcon,
    get label() {
      return m.settings_sidebar_agentBehavior_label();
    },
  },
  {
    id: 'connections',
    icon: PlugsConnectedIcon,
    get label() {
      return m.settings_sidebar_connections_label();
    },
  },
  {
    id: 'token-savings',
    icon: CoinsIcon,
    get label() {
      return m.settings_sidebar_tokenSavings_label();
    },
  },
  {
    id: 'devices',
    icon: DesktopIcon,
    get label() {
      return m.settings_sidebar_devices_label();
    },
  },
  {
    id: 'mobile',
    icon: DeviceMobileIcon,
    get label() {
      return m.settings_sidebar_mobile_label();
    },
  },
  {
    id: 'collaboration',
    icon: UsersIcon,
    get label() {
      return m.settings_sidebar_guestSessions_label();
    },
  },
  {
    id: 'app-behavior',
    icon: SlidersHorizontalIcon,
    get label() {
      return m.settings_sidebar_appBehavior_label();
    },
  },
  {
    id: 'display',
    icon: PaintBrushIcon,
    get label() {
      return m.settings_sidebar_display_label();
    },
  },
  {
    id: 'performance',
    icon: GaugeIcon,
    get label() {
      return m.settings_sidebar_performance_label();
    },
  },
  {
    id: 'input',
    icon: KeyboardIcon,
    get label() {
      return m.settings_sidebar_input_label();
    },
  },
  {
    id: 'passkeys',
    icon: KeyIcon,
    get label() {
      return m.settings_sidebar_passkeys_label();
    },
  },
  {
    id: 'setup',
    icon: GitBranchIcon,
    get label() {
      return m.settings_sidebar_setup_label();
    },
  },
  {
    id: 'advanced',
    icon: GearSixIcon,
    get label() {
      return m.settings_sidebar_advanced_label();
    },
  },
];

export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    id: 'agents',
    get label() {
      return m.settings_sidebar_agents_label();
    },
    items: primaryItems.slice(0, 4),
  },
  {
    id: 'remote',
    get label() {
      return m.settings_sidebar_remote_label();
    },
    items: primaryItems.slice(4, 7),
  },
  {
    id: 'preferences',
    get label() {
      return m.settings_sidebar_preferences_label();
    },
    items: primaryItems.slice(7),
  },
];
