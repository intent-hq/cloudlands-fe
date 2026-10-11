// Source: src/lib/components/settings/SettingsSidebarNav.svelte.
import type { ReactNode } from 'react';
import {
  DesktopIcon,
  DeviceMobileIcon,
  GearSixIcon,
  GitBranchIcon,
  KeyboardIcon,
  PaintBrushIcon,
  PlugsConnectedIcon,
  RobotIcon,
  SlidersHorizontalIcon,
  TerminalWindowIcon,
  UsersIcon,
} from '@phosphor-icons/react';
import { ListRow } from '@/components/patterns/collection';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import type { SettingsTab } from '@/components/patterns/settings/types';

export interface SettingsSidebarNavProps {
  activeTab: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
  agentsNavigation: ReactNode;
  hiddenTabs?: readonly SettingsTab[];
}
const groups = [
  {
    id: 'agents',
    label: () => m.settings_sidebar_agents_label(),
    items: [
      {
        id: 'agent-behavior',
        icon: RobotIcon,
        label: () => m.settings_sidebar_agentBehavior_label(),
      },
      {
        id: 'providers',
        icon: TerminalWindowIcon,
        label: () => m.settings_sidebar_providers_label(),
      },
      {
        id: 'connections',
        icon: PlugsConnectedIcon,
        label: () => m.settings_sidebar_connections_label(),
      },
    ],
  },
  {
    id: 'remote',
    label: () => m.settings_sidebar_remote_label(),
    items: [
      { id: 'devices', icon: DesktopIcon, label: () => m.settings_sidebar_devices_label() },
      { id: 'mobile', icon: DeviceMobileIcon, label: () => m.settings_sidebar_mobile_label() },
      {
        id: 'collaboration',
        icon: UsersIcon,
        label: () => m.settings_sidebar_guestSessions_label(),
      },
    ],
  },
  {
    id: 'preferences',
    label: () => m.settings_sidebar_preferences_label(),
    items: [
      { id: 'display', icon: PaintBrushIcon, label: () => m.settings_sidebar_display_label() },
      {
        id: 'app-behavior',
        icon: SlidersHorizontalIcon,
        label: () => m.settings_sidebar_appBehavior_label(),
      },
      { id: 'input', icon: KeyboardIcon, label: () => m.settings_sidebar_input_label() },
      { id: 'setup', icon: GitBranchIcon, label: () => m.settings_sidebar_setup_label() },
      { id: 'advanced', icon: GearSixIcon, label: () => m.settings_sidebar_advanced_label() },
    ],
  },
] satisfies {
  id: string;
  label: () => string;
  items: { id: SettingsTab; icon: typeof RobotIcon; label: () => string }[];
}[];

export function SettingsSidebarNav({
  activeTab,
  onSelect,
  agentsNavigation,
  hiddenTabs = [],
}: SettingsSidebarNavProps) {
  return (
    <nav
      className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto px-3 pt-1 pb-5"
      aria-label={m.settings_page_title()}
    >
      {groups.map((group) => {
        const items = group.items.filter((item) => !hiddenTabs.includes(item.id));
        return (
          items.length > 0 && (
            <section key={group.id} aria-labelledby={`settings-group-${group.id}`}>
              <h2
                id={`settings-group-${group.id}`}
                className="px-3 type-caption font-normal text-muted-foreground"
              >
                {group.label()}
              </h2>
              <div className="mt-2 flex flex-col gap-px">
                {items.map((item) => (
                  <Button
                    key={item.id}
                    variant="plain"
                    type="button"
                    onClick={() => onSelect(item.id)}
                    active={activeTab === item.id}
                    aria-current={activeTab === item.id ? 'page' : undefined}
                    data-settings-tab={item.id}
                    className={cn(
                      'h-auto w-full justify-start rounded-lg p-0 text-left type-caption font-normal hover:bg-hover active:bg-active',
                      activeTab === item.id
                        ? 'bg-foreground/5 text-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    <ListRow
                      className="min-h-8 w-full items-center gap-2 px-3 py-0 [&>[data-slot=list-row-leading]]:self-center"
                      leading={
                        <span
                          data-slot="settings-sidebar-icon"
                          className="flex size-4 shrink-0 items-center justify-center"
                        >
                          <item.icon size={16} weight="regular" aria-hidden="true" />
                        </span>
                      }
                      title={
                        <span
                          data-settings-sidebar-label
                          className="block truncate type-body font-normal"
                        >
                          {item.label()}
                        </span>
                      }
                    />
                  </Button>
                ))}
              </div>
            </section>
          )
        );
      })}
      <section
        data-settings-agents-section
        data-settings-specialists-section
        aria-labelledby="settings-group-specialists"
      >
        <h2
          id="settings-group-specialists"
          className="px-3 type-caption font-normal text-muted-foreground"
        >
          {m.settings_sidebar_specialists_label()}
        </h2>
        <div className="mt-2 flex flex-col gap-px">{agentsNavigation}</div>
      </section>
    </nav>
  );
}
