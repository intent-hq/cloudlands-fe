<script lang="ts">
  /** The Devices tab's section below the device list: backend sync. */
  import { m } from '$shared/paraglide/messages.js';
  import BackendSyncSettings from './BackendSyncSettings.svelte';
</script>

<div id="backend-sync" class="scroll-mt-20">
  <h2 class="type-title mb-3 text-foreground">
    {m.settings_section_backendSync()}
  </h2>
  <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
    <section data-slot="settings-section-body" class="px-6 py-4">
      <BackendSyncSettings />
    </section>
  </div>
</div>
