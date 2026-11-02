<script lang="ts">
  /**
   * The Devices tab's sections below the device list: backend sync, and
   * Browser access when this window is the desktop app (it needs main).
   */
  import { m } from '$shared/paraglide/messages.js';
  import { canManageBrowserAccess } from '$lib/browser-access';
  import BackendSyncSettings from './BackendSyncSettings.svelte';
  import BrowserAccessSettings from './BrowserAccessSettings.svelte';
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

{#if canManageBrowserAccess()}
  <div id="browser-access" class="scroll-mt-20">
    <h2 class="type-title mb-3 text-foreground">
      {m.settings_section_browserAccess()}
    </h2>
    <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
      <section data-slot="settings-section-body" class="px-6 py-4">
        <BrowserAccessSettings />
      </section>
    </div>
  </div>
{/if}
