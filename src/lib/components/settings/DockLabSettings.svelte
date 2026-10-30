<script lang="ts">
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import { Switch } from '$lib/components/ui/switch';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';
  import { m } from '$shared/paraglide/messages.js';
  import { dockLabEnabled, setDockLabEnabled } from '$lib/dock-lab';
  import DockLabIllustration from './DockLabIllustration.svelte';
</script>

<div id="labs" data-highlight-id="labs" use:highlightTarget>
  <h2 class="type-title mb-3 text-foreground">{m.settings_section_labs()}</h2>
  <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
    <section data-slot="settings-section-body" class="flex items-center gap-4 px-6 py-1">
      <DockLabIllustration />
      <SettingsFieldRow
        class="flex-1"
        id="settings-dockLab-label-field"
        label={m.settings_dockLab_label()}
        description={m.settings_dockLab_description()}
      >
        <Switch
          id="dock-lab-switch"
          size="sm"
          class="mb-auto"
          checked={$dockLabEnabled}
          onCheckedChange={(enabled) => void setDockLabEnabled(enabled)}
          ariaLabel={m.settings_dockLab_label()}
        />
      </SettingsFieldRow>
    </section>
  </div>
</div>
