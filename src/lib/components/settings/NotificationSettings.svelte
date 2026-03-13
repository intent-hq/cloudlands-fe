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

  import { selectNotificationEnabled, selectSoundEnabled, selectSoundOnlyWhenUnfocused, selectNotificationVolume } from '$lib/store/slices/notification-settings/notification-settings-selectors';
  import { setNotificationEnabled, setSoundEnabled, setSoundOnlyWhenUnfocused, setVolume } from '$lib/store/slices/notification-settings/notification-settings-slice';
  import { getDispatch } from '$lib/store/utils/utils';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { playNotificationSound } from '$lib/utils/notification-sound';
  import { faPlay } from '@fortawesome/free-solid-svg-icons';
  import Button from '../ui/button/button.svelte';
  import Fa from 'svelte-fa';

  const notificationEnabled = selectNotificationEnabled();
  const soundEnabled = selectSoundEnabled();
  const soundOnlyWhenUnfocused = selectSoundOnlyWhenUnfocused();
  const notificationVolume = selectNotificationVolume();
  const dispatch = getDispatch();

  let testSoundLoading = $state(false);

  async function handleTestSound() {
    testSoundLoading = true;
    try {
      await playNotificationSound($notificationVolume);
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
    dispatch(setVolume(normalized));
  }

  // Derive volume percentage from store (0-1 to 0-100)
  const volumePercentage = $derived(Math.round($notificationVolume * 100));
</script>

<div class="grid grid-cols-[repeat(auto-fit,_minmax(220px,_1fr))] gap-x-10 gap-y-6">
  <!-- Desktop notifications -->
  <div class="flex justify-between">
    <div>
      <p class="text-sm font-medium text-foreground">Desktop notifications</p>
      <p class="text-xs text-subtle">Show system notifications when tasks complete</p>
    </div>
    <Toggle
      pressed={$notificationEnabled}
      onclick={() => dispatch(setNotificationEnabled(!$notificationEnabled))}
      variant="indicator"
      size="xs"
      class="mb-auto"
    />
  </div>

  <!-- Sound notifications -->
  <div class="flex justify-between">
    <div>
      <p class="text-sm font-medium text-foreground">Sound</p>
      <p class="text-xs text-subtle">Play a sound when notifications arrive</p>
    </div>
    <Toggle
      pressed={$soundEnabled}
      onclick={() => dispatch(setSoundEnabled(!$soundEnabled))}
      variant="indicator"
      size="xs"
      class="mb-auto"
    />
  </div>

  <!-- Sound only when unfocused -->
  <div class="flex justify-between">
    <div>
      <p class="text-sm font-medium text-foreground">Only when unfocused</p>
      <p class="text-xs text-subtle">Only play sounds when the app is in the background</p>
    </div>
    <Toggle
      pressed={$soundOnlyWhenUnfocused}
      onclick={() => dispatch(setSoundOnlyWhenUnfocused(!$soundOnlyWhenUnfocused))}
      variant="indicator"
      size="xs"
      class="mb-auto"
    />
  </div>

  <!-- Volume control -->
  <div class="flex justify-between">
    <div>
      <p class="text-sm font-medium text-foreground">Volume</p>
      <p class="text-xs text-subtle">Notification sound volume</p>
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
      <span class="text-xs text-subtle w-8 text-right">{volumePercentage}%</span>
    </div>
  </div>
</div>
