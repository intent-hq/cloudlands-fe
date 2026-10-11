// Source: src/lib/components/settings/SettingsSidebarBack.svelte.
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/patterns/collection';
import { m } from '$shared/paraglide/messages.js';
import { isMacPlatform } from '$lib/utils/shortcuts';

export function SettingsSidebarBack({ onBack }: { onBack: () => void }) {
  return (
    <div className="shrink-0 px-3 pt-5 pb-5" data-settings-sidebar-back>
      <Button
        variant="plain"
        type="button"
        onClick={onBack}
        className="h-auto w-full justify-start rounded-lg p-0 text-left type-caption font-normal text-muted-foreground hover:bg-hover active:bg-active"
      >
        <ListRow
          className="min-h-8 w-full items-center gap-2 px-3 py-0 [&>[data-slot=list-row-leading]]:self-center [&>[data-slot=list-row-trailing]]:self-center"
          leading={
            <span className="flex size-4 shrink-0 items-center justify-center">
              <ArrowLeftIcon size={16} weight="regular" />
            </span>
          }
          title={
            <span
              data-settings-sidebar-label
              className="block truncate type-body font-normal text-muted-foreground"
            >
              {m.settings_sidebar_backToApp_label()}
            </span>
          }
          trailing={
            <kbd className="type-caption font-normal text-muted-foreground">
              {isMacPlatform() ? '⌘' : 'Ctrl'},
            </kbd>
          }
        />
      </Button>
    </div>
  );
}
