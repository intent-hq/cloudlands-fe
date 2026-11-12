<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { dockLabEnabled, setDockLabEnabled } from '$lib/dock-lab';
  import { highlightTarget } from '$lib/components/patterns/settings/highlight-target';
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import DockLabIllustration from './DockLabIllustration.svelte';

  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'dock-lab',
          title: m.settings_dockLab_label(),
          entries: [
            {
              kind: 'switch',
              id: 'dock-lab-switch',
              size: 'sm',
              label: m.settings_dockLab_label(),
              description: m.settings_dockLab_description(),
              get: () => $dockLabEnabled,
              set: setDockLabEnabled,
            },
          ],
        },
      ],
    }),
  );
</script>

<!-- A row of the Appearance card (Settings › Display); desktop-only. While the lab is
off the row is hidden; Settings › Labs turns it on. -->
{#if isElectronPlatform() && $dockLabEnabled}
  <section
    id="notch-dock"
    data-highlight-id="notch-dock"
    use:highlightTarget
    data-slot="settings-section-body"
    class="px-6 py-4"
  >
    <div class="flex items-center gap-4">
      <DockLabIllustration />
      <div class="min-w-0 flex-1">
        <SettingsForm {schema} embedded compact={false} />
        <p class="mt-2 type-caption text-muted-foreground">{m.settings_dockLab_moveHint()}</p>
      </div>
    </div>
  </section>
{/if}
