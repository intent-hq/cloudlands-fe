<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { dockLabEnabled, setDockLabEnabled } from '$lib/dock-lab';
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

<!-- A row of the Appearance card (Settings › Display). -->
<div class="flex items-center gap-4">
  <DockLabIllustration />
  <div class="min-w-0 flex-1">
    <SettingsForm {schema} embedded compact={false} />
  </div>
</div>
