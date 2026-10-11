// Source: src/lib/components/patterns/settings/SettingsPage.svelte.
import type { ReactNode } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { SettingsSidebarNav } from '@/components/settings/settings-sidebar-nav';
import { SettingsPageShell } from '@/components/ui/settings-page-shell';
import { TabsTrigger } from '@/components/ui/tabs';
import { SettingsForm } from './settings-form';
import type {
  SettingsCustomControls,
  SettingsDescriptionSnippets,
  SettingsSchema,
  SettingsTab,
} from './types';
import './settings.css';

export interface SettingsPageProps {
  title: string;
  description?: string;
  schema?: SettingsSchema;
  searchQuery?: string;
  custom?: SettingsCustomControls;
  descriptions?: SettingsDescriptionSnippets;
  navigation?: ReactNode;
  activeTab: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
  agentsNavigation: ReactNode;
  hiddenTabs?: readonly SettingsTab[];
  sidebarHeader?: ReactNode;
  sidebarFooter?: ReactNode;
  children?: ReactNode;
}
export function SettingsPage({
  title,
  description,
  schema,
  searchQuery = '',
  custom = {},
  descriptions = {},
  navigation,
  activeTab,
  onSelect,
  agentsNavigation,
  hiddenTabs = [],
  sidebarHeader,
  sidebarFooter,
  children,
}: SettingsPageProps) {
  useSignals();
  return (
    <div data-slot="settings-page" className="flex h-full min-h-0 min-w-0 overflow-hidden">
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar">
        {sidebarHeader}
        <SettingsSidebarNav
          activeTab={activeTab}
          onSelect={onSelect}
          agentsNavigation={agentsNavigation}
          hiddenTabs={hiddenTabs}
        />
        {sidebarFooter}
      </aside>
      {children != null
        ? children
        : schema && (
            <div className="min-w-0 flex-1">
              <SettingsPageShell
                title={title}
                description={description}
                navigationLabel={title}
                navigation={
                  <div className="sticky top-0 z-10 bg-card">
                    {navigation ??
                      schema.sections
                        .filter((section) => section.when?.() ?? true)
                        .map((section) => (
                          <TabsTrigger key={section.id} value={section.id}>
                            {section.title}
                          </TabsTrigger>
                        ))}
                  </div>
                }
              >
                <SettingsForm
                  schema={schema}
                  searchQuery={searchQuery}
                  custom={custom}
                  descriptions={descriptions}
                  compact={false}
                />
              </SettingsPageShell>
            </div>
          )}
    </div>
  );
}
