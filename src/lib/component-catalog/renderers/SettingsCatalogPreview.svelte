<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Form } from '$lib/components/patterns/form';
  import { FileInput } from '$lib/components/ui/file-input';
  import { SettingsFieldRow } from '$lib/components/ui/settings-field-row';
  import { SettingsPageShell } from '$lib/components/ui/settings-page-shell';
  import { SettingsSection } from '$lib/components/ui/settings-section';
  import { Slider } from '$lib/components/ui/slider';
  import * as Tabs from '$lib/components/ui/tabs';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { componentId, fixture }: CatalogRendererProps = $props();
  let volume = $state(45);
  let selectedFiles = $state<FileList | undefined>();
  let backActionCount = $state(0);
  let settingsTab = $state('general');
</script>

<div
  class="min-w-0"
  data-catalog-renderer-fixture={fixture.id}
  data-catalog-rendered-state={fixture.states.join(' ')}
>
  {#if componentId === 'settings-page-shell'}
    <SettingsPageShell
      title="Application settings"
      description="Configure appearance, notifications, providers, and workspace behavior from one focused surface with a deliberately long description that remains readable."
      backHref={fixture.id === 'busy-shell' ? '#catalog-settings-shell' : undefined}
      backLabel="Back to workspace"
      backShortcut={fixture.id === 'busy-shell' ? undefined : '⌘,'}
      backShortcutLabel={fixture.id === 'busy-shell' ? undefined : 'Command comma'}
      onBack={fixture.id === 'busy-shell' ? undefined : () => (backActionCount += 1)}
      busy={fixture.id === 'busy-shell'}
      measure={fixture.id === 'busy-shell' ? 'wide' : 'standard'}
      class="h-128 rounded-md border border-border"
      contentClass="py-4 sm:py-5"
      bind:navigationValue={settingsTab}
      navigationLabel="Catalog settings sections"
    >
      {#snippet navigation()}
        <Tabs.Trigger value="general">General settings</Tabs.Trigger>
        <Tabs.Trigger value="appearance">Appearance and colors</Tabs.Trigger>
        <Tabs.Trigger value="accounts">Accounts and providers</Tabs.Trigger>
        <Tabs.Trigger value="workspace">Workspace behavior</Tabs.Trigger>
        <Tabs.Trigger value="agents">Agent preferences</Tabs.Trigger>
      {/snippet}
      <div class="min-h-128" data-testid="catalog-settings-long-content">
        <SettingsSection
          id="catalog-general"
          title="General"
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
              bind:value={volume}
              aria-label="Shell notification volume"
              class="w-40"
            />
          </SettingsFieldRow>
        </SettingsSection>
      </div>
      {#snippet footer()}
        <div class="flex items-center justify-between gap-4">
          <span>Changes save according to each field's existing behavior.</span>
          <output class="sr-only" aria-label="Catalog back action count">{backActionCount}</output>
        </div>
      {/snippet}
    </SettingsPageShell>
  {:else if componentId === 'settings-section'}
    <SettingsSection
      id="catalog-notifications"
      title="Notifications"
      description="Choose how the application gets your attention, including a longer explanatory sentence for compact wrapping."
      error="Notification preferences could not be saved."
      busy
    >
      {#snippet actions()}<Button variant="outline" size="sm">Reset section</Button>{/snippet}
      <p class="text-sm text-muted-foreground">
        Section content remains grouped without a nested card.
      </p>
    </SettingsSection>
  {:else if componentId === 'settings-field-row'}
    <div class="space-y-6">
      <SettingsFieldRow
        id="catalog-volume-row"
        label="Notification volume"
        description="Controls the volume used for application notifications."
        htmlFor="catalog-volume"
      >
        {#snippet control({ descriptionId })}
          <div class="flex w-48 items-center gap-3">
            <Slider
              id="catalog-volume"
              bind:value={volume}
              aria-label="Field row volume"
              aria-describedby={descriptionId}
            />
            <output aria-label="Field row volume value">{volume}</output>
          </div>
        {/snippet}
      </SettingsFieldRow>
      <SettingsFieldRow
        id="catalog-invalid-row"
        label="Unavailable setting"
        description="This row demonstrates compact, disabled, busy, and invalid feedback."
        error="Choose a valid value."
        disabled
        busy
        compact
      >
        {#snippet control({ labelId, descriptionId, errorId, disabled })}
          <Slider
            value={20}
            {disabled}
            aria-labelledby={labelId}
            aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ')}
            aria-invalid="true"
          />
        {/snippet}
      </SettingsFieldRow>
    </div>
  {:else if componentId === 'slider'}
    <div class="grid max-w-md gap-5" data-slider-capture-delay-ms="200">
      <div class="grid gap-1 text-sm">
        <span class="text-muted-foreground">Default</span>
        <Slider
          bind:value={volume}
          aria-label="Catalog volume"
          data-capture-interaction="hover-drag"
        />
      </div>
      <div class="grid gap-1 text-sm">
        <span class="text-muted-foreground">Inline value</span>
        <Slider value={62} showValue valuePosition="right" aria-label="Catalog volume with value" />
      </div>
      <div class="grid gap-1 text-sm">
        <span class="text-muted-foreground">Discrete steps</span>
        <Slider
          value={40}
          steps={[0, 15, 40, 70, 100]}
          showSteps
          showValue
          valuePosition="right"
          formatValue={(value) => `${value}%`}
          aria-label="Catalog stepped volume"
        />
      </div>
      <div class="grid gap-1 text-sm">
        <span class="text-muted-foreground">Disabled</span>
        <Slider value={25} disabled aria-label="Disabled catalog volume" />
      </div>
      <output class="sr-only" aria-label="Catalog slider value">{volume}</output>
    </div>
  {:else if componentId === 'file-input'}
    <div class="grid gap-4">
      <Form class="grid gap-3" data-testid="catalog-file-form" onSubmit={() => {}}>
        <FileInput
          id="catalog-theme-file"
          label="Choose theme files"
          accept=".json,application/json"
          multiple
          required
          name="themeFiles"
          bind:files={selectedFiles}
          emptyText="No theme file selected"
        />
        <div class="flex flex-wrap gap-2">
          <Button type="reset" variant="outline" size="sm">Reset form</Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onclick={() => (selectedFiles = undefined)}
          >
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
  {/if}
</div>
