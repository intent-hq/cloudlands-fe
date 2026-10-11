// Source: SettingsCatalogPreview.svelte. Settings-specific branches are added with their public exports.
// i18n-ignore (reference catalog fixture content)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileInput } from '@/components/ui/file-input';
import { Slider } from '@/components/ui/slider';
import { SettingsFieldRow, SettingsSection } from '@/components/patterns/settings';
import { SettingsPageShell } from '@/components/ui/settings-page-shell';
import { TabsTrigger } from '@/components/ui/tabs';
import { Form } from '@/components/patterns/form';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export function SettingsCatalogPreview({
  componentId,
  fixture,
}: {
  componentId: string;
  fixture: UiComponentFixture;
}) {
  const [volume, setVolume] = useState(45);
  const [backActionCount, setBackActionCount] = useState(0);
  const [settingsTab, setSettingsTab] = useState('general');
  const [files, setFiles] = useState<FileList | undefined>();
  return (
    <div
      className="min-w-0"
      data-catalog-renderer-fixture={fixture.id}
      data-catalog-rendered-state={fixture.states.join(' ')}
    >
      {componentId === 'settings-page-shell' && (
        <SettingsPageShell
          title={fixture.title}
          description="Configure appearance, notifications, providers, and workspace behavior from one focused surface with a deliberately long description that remains readable."
          backHref={fixture.id === 'busy-shell' ? '#catalog-settings-shell' : undefined}
          backLabel="Back to workspace"
          backShortcut={fixture.id === 'busy-shell' ? undefined : '⌘,'}
          backShortcutLabel={fixture.id === 'busy-shell' ? undefined : 'Command comma'}
          onBack={
            fixture.id === 'busy-shell' ? undefined : () => setBackActionCount((count) => count + 1)
          }
          busy={fixture.id === 'busy-shell'}
          measure={fixture.id === 'busy-shell' ? 'wide' : 'standard'}
          className="h-128 rounded-md border border-border"
          contentClass="py-4 sm:py-5"
          navigationValue={settingsTab}
          onNavigationValueChange={setSettingsTab}
          navigationLabel="Catalog settings sections"
          navigation={
            <>
              <TabsTrigger value="general">General settings</TabsTrigger>
              <TabsTrigger value="appearance">Appearance and colors</TabsTrigger>
              <TabsTrigger value="accounts">Accounts and providers</TabsTrigger>
              <TabsTrigger value="workspace">Workspace behavior</TabsTrigger>
              <TabsTrigger value="agents">Agent preferences</TabsTrigger>
            </>
          }
          footer={
            <div className="flex items-center justify-between gap-4">
              <span>Changes save according to each field's existing behavior.</span>
              <output className="sr-only" aria-label="Catalog back action count">
                {backActionCount}
              </output>
            </div>
          }
        >
          <div className="min-h-128" data-testid="catalog-settings-long-content">
            <SettingsSection
              id={`catalog-${fixture.id}-general`}
              title={`${fixture.title} general`}
              description="Common application behavior."
            >
              <SettingsFieldRow
                id="catalog-shell-volume"
                label="Notification volume"
                description="Choose the volume for application notifications."
                htmlFor="catalog-shell-volume-control"
                compact
              >
                <Slider
                  id="catalog-shell-volume-control"
                  value={volume}
                  onValueChange={setVolume}
                  aria-label="Shell notification volume"
                  className="w-40"
                />
              </SettingsFieldRow>
            </SettingsSection>
          </div>
        </SettingsPageShell>
      )}
      {componentId === 'settings-section' && (
        <SettingsSection
          id="catalog-notifications"
          title="Notifications"
          description="Choose how the application gets your attention, including a longer explanatory sentence for compact wrapping."
          error="Notification preferences could not be saved."
          busy
          actions={
            <Button variant="outline" size="sm">
              Reset section
            </Button>
          }
        >
          <p className="text-sm text-muted-foreground">
            Section content remains grouped without a nested card.
          </p>
        </SettingsSection>
      )}
      {componentId === 'settings-field-row' && (
        <div className="space-y-6">
          <SettingsFieldRow
            id="catalog-volume-row"
            label="Notification volume"
            description="Controls the volume used for application notifications."
            htmlFor="catalog-volume"
            control={({ descriptionId }) => (
              <div className="flex w-48 items-center gap-3">
                <Slider
                  id="catalog-volume"
                  value={volume}
                  onValueChange={setVolume}
                  aria-label="Field row volume"
                  aria-describedby={descriptionId}
                />
                <output aria-label="Field row volume value">{volume}</output>
              </div>
            )}
          />
          <SettingsFieldRow
            id="catalog-invalid-row"
            label="Unavailable setting"
            description="This row demonstrates compact, disabled, busy, and invalid feedback."
            error="Choose a valid value."
            disabled
            busy
            compact
            control={({ labelId, descriptionId, errorId, disabled }) => (
              <Slider
                value={20}
                disabled={disabled}
                aria-labelledby={labelId}
                aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ')}
                aria-invalid="true"
              />
            )}
          />
        </div>
      )}
      {componentId === 'slider' && (
        <div className="grid max-w-md gap-5" data-slider-capture-delay-ms="200">
          <div className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Default</span>
            <Slider
              value={volume}
              onValueChange={setVolume}
              aria-label="Catalog volume"
              data-capture-interaction="hover-drag"
            />
          </div>
          <div className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Inline value</span>
            <Slider
              defaultValue={62}
              showValue
              valuePosition="right"
              aria-label="Catalog volume with value"
            />
          </div>
          <div className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Discrete steps</span>
            <Slider
              defaultValue={40}
              steps={[0, 15, 40, 70, 100]}
              showSteps
              showValue
              valuePosition="right"
              formatValue={(value) => `${value}%`}
              aria-label="Catalog stepped volume"
            />
          </div>
          <div className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Disabled</span>
            <Slider value={25} disabled aria-label="Disabled catalog volume" />
          </div>
          <output className="sr-only" aria-label="Catalog slider value">
            {volume}
          </output>
        </div>
      )}
      {componentId === 'file-input' && (
        <div className="grid gap-4">
          <Form className="grid gap-3" data-testid="catalog-file-form" onSubmit={() => undefined}>
            <FileInput
              id="catalog-theme-file"
              label="Choose theme files"
              accept=".json,application/json"
              multiple
              required
              name="themeFiles"
              files={files}
              onFilesChange={setFiles}
              emptyText="No theme file selected"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="reset" variant="outline" size="sm">
                Reset form
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setFiles(undefined)}>
                Reset from parent
              </Button>
            </div>
          </Form>
          <FileInput id="catalog-hover-file" label="Hover file input" state="hover" />
          <FileInput id="catalog-focus-file" label="Focused file input" state="focus" />
          <FileInput
            id="catalog-invalid-file"
            label="Choose invalid file"
            emptyText="A-very-long-localized-filename-that-must-truncate-without-overflow.json"
            invalid
            error="The selected file must contain a valid theme."
          />
          <FileInput id="catalog-disabled-file" label="Choose disabled file" disabled />
          <FileInput id="catalog-busy-file" label="Importing theme" busy />
        </div>
      )}
    </div>
  );
}
