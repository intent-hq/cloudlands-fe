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
  import { Toggle } from '$lib/components/ui/toggle';
  import { playNotificationSound } from '$lib/utils/notification-sound';
  import { hasCapability } from '$lib/utils/platform-capabilities';
  import { faPlay, faFolderOpen, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
  import Button from '../ui/button/button.svelte';
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

  function handleVolumeChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const percentage = parseInt(target.value, 10);
    const normalized = percentage / 100;
    appStore.dispatch(setVolume(normalized));
  }

  // Derive volume percentage from store (0-1 to 0-100)
  const volumePercentage = $derived(Math.round($notificationVolume * 100));
  const volumePercentageLabel = $derived(
    formatNumber(volumePercentage / 100, { style: 'percent', maximumFractionDigits: 0 }),
  );
</script>

<div class="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
  <!-- Desktop notifications -->
  <div class="flex justify-between">
    <div>
      <p class="text-sm font-medium text-foreground">{m.settings_notifications_desktop_label()}</p>
      <p class="text-xs text-subtle">{m.settings_notifications_desktop_description()}</p>
    </div>
    <Toggle
      pressed={$notificationEnabled}
      onclick={() => appStore.dispatch(setNotificationEnabled(!$notificationEnabled))}
      variant="indicator"
      size="xs"
      class="mb-auto"
      ariaLabel={m.settings_notifications_desktop_label()}
    />
  </div>

  <!-- Sound notifications -->
  <div class="flex justify-between gap-3">
    <div class="min-w-0">
      <p class="text-sm font-medium text-foreground">{m.settings_notifications_sound_label()}</p>
      <p class="text-xs text-subtle">{m.settings_notifications_sound_description()}</p>
      {#if $soundPath}
        <p class="text-xs text-subtle truncate" title={$soundPath}>
          <span aria-hidden="true">{soundFilename}</span>
          <span class="sr-only">{$soundPath}</span>
        </p>
      {/if}
      {#if pickerFailed}
        <p role="alert" class="text-xs text-destructive">
          {m.settings_notifications_chooseSound_error()}
        </p>
      {/if}
    </div>
    <div class="flex items-start gap-1 shrink-0">
      <Toggle
        pressed={$soundEnabled}
        onclick={() => appStore.dispatch(setSoundEnabled(!$soundEnabled))}
        variant="indicator"
        size="xs"
        ariaLabel={m.settings_notifications_sound_label()}
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
  </div>

  <!-- Sound only when unfocused -->
  <div class="flex justify-between">
    <div>
      <p class="text-sm font-medium text-foreground">
        {m.settings_notifications_unfocusedOnly_label()}
      </p>
      <p class="text-xs text-subtle">{m.settings_notifications_unfocusedOnly_description()}</p>
    </div>
    <Toggle
      pressed={$soundOnlyWhenUnfocused}
      onclick={() => appStore.dispatch(setSoundOnlyWhenUnfocused(!$soundOnlyWhenUnfocused))}
      variant="indicator"
      size="xs"
      class="mb-auto"
      ariaLabel={m.settings_notifications_unfocusedOnly_label()}
    />
  </div>

  <!-- Volume control -->
  <div class="flex justify-between">
    <div>
      <p class="text-sm font-medium text-foreground">{m.settings_notifications_volume_label()}</p>
      <p class="text-xs text-subtle">{m.settings_notifications_volume_description()}</p>
    </div>
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
      <input
        type="range"
        min="0"
        max="100"
        value={volumePercentage}
        oninput={handleVolumeChange}
        class="w-24 h-1.5 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
      />
      <span class="text-xs text-subtle w-8 text-right">{volumePercentageLabel}</span>
    </div>
  </div>
</div>
