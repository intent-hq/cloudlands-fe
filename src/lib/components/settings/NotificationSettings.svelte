<script lang="ts">
  /**
   * Notification Settings Component
   *
   * Allows users to configure notification preferences including:
   * - Desktop notifications
   * - Sound notifications
   * - Sound only when unfocused
   * - Volume control
   */

  import {
    selectNotificationEnabled,
    selectSoundEnabled,
    selectSoundPath,
    selectSoundOnlyWhenUnfocused,
    selectNotificationVolume,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    setNotificationEnabled,
    setSoundEnabled,
    setSoundPath,
    pickNotificationSoundRequested,
    setSoundOnlyWhenUnfocused,
    setVolume,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';

  import { m } from '$shared/paraglide/messages.js';
  import { formatNumber } from '$lib/i18n/format';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
    type SettingsControlContext,
  } from '$lib/components/patterns/settings';
  import { Button, Slider, Switch } from '$lib/components/patterns/settings/custom-controls';
  import { playNotificationSound } from '$lib/utils/notification-sound';
  import { hasCapability } from '$lib/utils/platform-capabilities';
  import { faPlay, faFolderOpen, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { store as appStore } from '$store/renderer/store';

  const notificationEnabled = selectNotificationEnabled();
  const soundEnabled = selectSoundEnabled();
  const soundPath = selectSoundPath();
  const canPickSound = hasCapability('nativeDialogs');
  const soundFilename = $derived($soundPath.split(/[\\/]/).pop());
  let pickerLoading = $state(false);
  let pickerFailed = $state(false);

  async function handlePickSound() {
    pickerLoading = true;
    pickerFailed = false;
    try {
      const action = pickNotificationSoundRequested();
      appStore.dispatch(action);
      await action.promise;
    } catch {
      pickerFailed = true;
    } finally {
      pickerLoading = false;
    }
  }
  const soundOnlyWhenUnfocused = selectSoundOnlyWhenUnfocused();
  const notificationVolume = selectNotificationVolume();

  let testSoundLoading = $state(false);

  async function handleTestSound() {
    testSoundLoading = true;
    try {
      await playNotificationSound($notificationVolume, $soundPath);
    } catch {
      // Silently fail
    } finally {
      testSoundLoading = false;
    }
  }

  function handleVolumeChange(percentage: number) {
    appStore.dispatch(setVolume(percentage / 100));
  }

  // Derive volume percentage from store (0-1 to 0-100)
  const volumePercentage = $derived(Math.round($notificationVolume * 100));
  const volumePercentageLabel = $derived(
    formatNumber(volumePercentage / 100, { style: 'percent', maximumFractionDigits: 0 }),
  );

  const schema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'notifications',
          title: m.settings_section_notifications(),
          entries: [
            {
              kind: 'switch',
              id: 'notification-desktop',
              label: m.settings_notifications_desktop_label(),
              description: m.settings_notifications_desktop_description(),
              get: () => $notificationEnabled,
              set: (value: boolean) => {
                appStore.dispatch(setNotificationEnabled(value));
              },
            },
            {
              kind: 'custom',
              id: 'notification-sound',
              label: m.settings_notifications_sound_label(),
              description: m.settings_notifications_sound_description(),
              error: () =>
                pickerFailed ? m.settings_notifications_chooseSound_error() : undefined,
            },
            {
              kind: 'switch',
              id: 'notification-unfocused',
              label: m.settings_notifications_unfocusedOnly_label(),
              description: m.settings_notifications_unfocusedOnly_description(),
              get: () => $soundOnlyWhenUnfocused,
              set: (value: boolean) => {
                appStore.dispatch(setSoundOnlyWhenUnfocused(value));
              },
            },
            {
              kind: 'custom',
              id: 'notification-volume',
              label: m.settings_notifications_volume_label(),
              description: m.settings_notifications_volume_description(),
            },
          ],
        },
      ],
    }),
  );
</script>

{#snippet soundControl({ labelId, descriptionId }: SettingsControlContext)}
  <div class="flex min-w-0 flex-col items-end gap-1">
    <div class="flex shrink-0 items-center gap-1">
      <Switch
        checked={$soundEnabled}
        onCheckedChange={(value) => appStore.dispatch(setSoundEnabled(value))}
        ariaLabelledby={labelId}
        ariaDescribedby={descriptionId}
        size="compact"
      />
      {#if canPickSound}
        <Button
          variant="ghost-light"
          size="icon-xs"
          aria-label={m.settings_notifications_chooseSound_ariaLabel()}
          title={m.settings_notifications_chooseSound_ariaLabel()}
          onclick={handlePickSound}
          disabled={pickerLoading}
        >
          <Fa icon={faFolderOpen} size={12} />
        </Button>
      {/if}
      {#if $soundPath}
        <Button
          variant="ghost-light"
          size="icon-xs"
          aria-label={m.settings_notifications_clearSound_ariaLabel()}
          title={m.settings_notifications_clearSound_ariaLabel()}
          disabled={pickerLoading}
          onclick={() => {
            pickerFailed = false;
            appStore.dispatch(setSoundPath(''));
          }}
        >
          <Fa icon={faRotateLeft} size={10} />
        </Button>
      {/if}
    </div>
    {#if $soundPath}
      <p class="type-caption max-w-48 truncate text-muted-foreground" title={$soundPath}>
        <span aria-hidden="true">{soundFilename}</span>
        <span class="sr-only">{$soundPath}</span>
      </p>
    {/if}
  </div>
{/snippet}

{#snippet volumeControl({ labelId, descriptionId }: SettingsControlContext)}
  <div class="flex items-center gap-3">
    <Button
      variant="ghost-light"
      size="icon-xs"
      aria-label={m.settings_notifications_testSound_ariaLabel()}
      onclick={handleTestSound}
      disabled={testSoundLoading}
    >
      <Fa icon={faPlay} size={10} />
    </Button>
    <Slider
      value={volumePercentage}
      min={0}
      max={100}
      onValueChange={handleVolumeChange}
      formatValue={(value) =>
        formatNumber(value / 100, { style: 'percent', maximumFractionDigits: 0 })}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      class="w-24"
    />
    <span class="type-caption w-8 text-right text-muted-foreground">{volumePercentageLabel}</span>
  </div>
{/snippet}

<SettingsForm
  {schema}
  compact={false}
  custom={defineSettingsCustomControls({
    'notification-sound': soundControl,
    'notification-volume': volumeControl,
  })}
/>
