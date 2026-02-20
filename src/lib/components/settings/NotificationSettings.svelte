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

  import { notificationSettingsStore } from '$lib/stores/notification-settings.store.svelte';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { playNotificationSound } from '$lib/utils/notification-sound';
  import { faPlay } from '@fortawesome/free-solid-svg-icons';
  import Button from '../ui/button/button.svelte';
  import Fa from 'svelte-fa';

  let testSoundLoading = $state(false);

  async function handleTestSound() {
    testSoundLoading = true;
    try {
      await playNotificationSound(notificationSettingsStore.volume);
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
    notificationSettingsStore.setVolume(normalized);
  }

  // Derive volume percentage from store (0-1 to 0-100)
  const volumePercentage = $derived(Math.round(notificationSettingsStore.volume * 100));
</script>

<div class="grid grid-cols-[repeat(auto-fit,_minmax(220px,_1fr))] gap-x-10 gap-y-6">
  <!-- Desktop notifications -->
  <div class="flex justify-between">
    <div>
      <p class="text-sm font-medium text-foreground">Desktop notifications</p>
      <p class="text-xs text-muted-foreground">Show system notifications when tasks complete</p>
    </div>
    <Toggle
      pressed={notificationSettingsStore.enabled}
      onclick={() => notificationSettingsStore.setEnabled(!notificationSettingsStore.enabled)}
      variant="indicator"
      size="xs"
      class="mb-auto"
    />
  </div>

  <!-- Sound notifications -->
  <div class="flex justify-between">
    <div>
      <p class="text-sm font-medium text-foreground">Sound</p>
      <p class="text-xs text-muted-foreground">Play a sound when notifications arrive</p>
    </div>
    <Toggle
      pressed={notificationSettingsStore.soundEnabled}
      onclick={() =>
        notificationSettingsStore.setSoundEnabled(!notificationSettingsStore.soundEnabled)}
      variant="indicator"
      size="xs"
      class="mb-auto"
    />
  </div>

  <!-- Sound only when unfocused -->
  <div class="flex justify-between">
    <div>
      <p class="text-sm font-medium text-foreground">Only when unfocused</p>
      <p class="text-xs text-muted-foreground">Only play sounds when the app is in the background</p>
    </div>
    <Toggle
      pressed={notificationSettingsStore.soundOnlyWhenUnfocused}
      onclick={() =>
        notificationSettingsStore.setSoundOnlyWhenUnfocused(
          !notificationSettingsStore.soundOnlyWhenUnfocused,
        )}
      variant="indicator"
      size="xs"
      class="mb-auto"
    />
  </div>

  <!-- Volume control -->
  <div class="flex justify-between">
    <div>
      <p class="text-sm font-medium text-foreground">Volume</p>
      <p class="text-xs text-muted-foreground">Notification sound volume</p>
    </div>
    <div class="flex items-center gap-3">
      <Button
        variant="ghost-light"
        size="icon-xs"
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
      <span class="text-xs text-muted-foreground w-8 text-right">{volumePercentage}%</span>
    </div>
  </div>
</div>
