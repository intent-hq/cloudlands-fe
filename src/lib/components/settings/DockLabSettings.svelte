<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { dockLabEnabled, setDockLabEnabled } from '$lib/dock-lab';
  import { isDockLabAvailable } from '$lib/utils/dock-lab-availability';
  import { highlightTarget } from '$lib/components/patterns/settings/highlight-target';
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
              class: 'py-0 first:pt-0 last:pb-0',
              get: () => $dockLabEnabled,
              set: setDockLabEnabled,
            },
          ],
        },
      ],
    }),
  );
</script>

<!-- The desktop-only notch control is the first card in Settings › Inputs. -->
{#if isDockLabAvailable()}
  <section
    id="notch-dock"
    data-highlight-id="notch-dock"
    use:highlightTarget
    data-slot="settings-section-body"
    class="@container/dock-settings px-6 py-4"
  >
    <div class="flex items-center gap-4">
      <div class="hidden shrink-0 @min-[32rem]/dock-settings:block">
        <DockLabIllustration />
      </div>
      <div class="min-w-0 flex-1">
        <SettingsForm {schema} embedded compact={false} />
        <p class="mt-2 type-caption text-muted-foreground">{m.settings_dockLab_moveHint()}</p>
      </div>
    </div>
  </section>
{/if}
