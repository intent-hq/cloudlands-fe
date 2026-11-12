<script lang="ts">
  /**
   * Browser access (Settings → Mobile), shown only in the desktop app because
   * main owns the setting and the server, and only while the experimental
   * Labs flag is on (Settings → Labs → Browser access). The warning stays visible while the
   * feature is off so nobody turns it on without reading it.
   */
  import Fa from 'svelte-fa';
  import { faTriangleExclamation } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { canManageBrowserAccess } from '$lib/browser-access';
  import { selectLabsBrowserAccessEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import BrowserAccessSettings from './BrowserAccessSettings.svelte';

  const unlocked$ = selectLabsBrowserAccessEnabled();
</script>

{#if canManageBrowserAccess() && $unlocked$}
  <div id="browser-access" class="scroll-mt-20">
    <h2 class="type-title mb-3 text-foreground">
      {m.settings_section_browserAccess()}
    </h2>
    <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
      <section data-slot="settings-section-body" class="flex flex-col gap-4 px-6 py-4">
        <div
          role="note"
          data-testid="browser-access-warning"
          class="flex items-start gap-2 p-3 bg-danger-background/10 border border-danger/30 rounded-md text-danger"
        >
          <Fa icon={faTriangleExclamation} class="mt-0.5 w-4 h-4 flex-shrink-0" />
          <div class="flex flex-col gap-1">
            <span class="type-body font-medium">{m.settings_browserAccess_warning_title()}</span>
            <span class="type-body">{m.settings_browserAccess_warning_description()}</span>
          </div>
        </div>
        <BrowserAccessSettings />
      </section>
    </div>
  </div>
{/if}
