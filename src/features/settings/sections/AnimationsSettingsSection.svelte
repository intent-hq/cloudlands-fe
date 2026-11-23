<script lang="ts">
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import ChatAuroraSettings from '$lib/components/settings/ChatAuroraSettings.svelte';
  import ReduceMotionOnBatterySettings from '$lib/components/settings/ReduceMotionOnBatterySettings.svelte';
  import PauseAnimationsWhenUnfocusedSettings from '$lib/components/settings/PauseAnimationsWhenUnfocusedSettings.svelte';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';
  import { Switch } from '$lib/components/ui/switch';
  import { setShellTransparencyEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { selectShellTransparencyEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  let { show }: { show: (row: string) => boolean } = $props();

  const shellTransparencyEnabled = selectShellTransparencyEnabled();
</script>

<div id="performance" data-highlight-id="performance" use:highlightTarget>
  <h2 class="type-title mb-3 text-foreground">
    {m.settings_section_animationsAndEffects()}
  </h2>
  <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
    {#if show('chat-aurora')}
      <ChatAuroraSettings />
    {/if}
    {#if show('translucent-window')}
      <section
        id="translucent-window"
        data-highlight-id="translucent-window"
        use:highlightTarget
        data-slot="settings-section-body"
        class="px-6 py-4"
      >
        <SettingsFieldRow
          id="settings-appearance-translucentWindow-label-field"
          label={m.settings_appearance_translucentWindow_label()}
          description={m.settings_appearance_translucentWindow_description()}
        >
          <Switch
            id="translucent-window-switch"
            size="sm"
            class="mb-auto"
            checked={$shellTransparencyEnabled}
            onCheckedChange={(enabled) => appStore.dispatch(setShellTransparencyEnabled(enabled))}
            ariaLabel={m.settings_appearance_translucentWindow_label()}
          />
        </SettingsFieldRow>
      </section>
    {/if}
    {#if show('reduce-motion-on-battery')}
      <section
        id="reduce-motion-on-battery"
        data-highlight-id="reduce-motion-on-battery"
        use:highlightTarget
        data-slot="settings-section-body"
        class="px-6 py-4"
      >
        <ReduceMotionOnBatterySettings />
      </section>
    {/if}
    {#if show('pause-animations-when-unfocused')}
      <section
        id="pause-animations-when-unfocused"
        data-highlight-id="pause-animations-when-unfocused"
        use:highlightTarget
        data-slot="settings-section-body"
        class="px-6 py-4"
      >
        <PauseAnimationsWhenUnfocusedSettings />
      </section>
    {/if}
  </div>
</div>
