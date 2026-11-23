<script lang="ts">
  import ProviderSelector from '$lib/components/settings/ProviderSelector.svelte';
  import ConnectionsSettings from '$lib/components/settings/ConnectionsSettings.svelte';
  import McpServersSettings from '$lib/components/settings/McpServersSettings.svelte';
  import PluginsSettings from '$lib/components/settings/PluginsSettings.svelte';
  import { selectAgentPluginsSupported } from '$store/renderer/slices/principal/principal-selectors';
  import BackgroundAgentSettings from '$lib/components/settings/BackgroundAgentSettings.svelte';
  import DefaultAgentModelSettings from '$lib/components/settings/DefaultAgentModelSettings.svelte';
  import { highlightTarget } from '$lib/components/patterns/settings/highlight-target';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspaceId } from '$shared/types/branded-ids';

  // Providers and Connections are administrator-owned daemon state (multiplayer
  // w3); the settings page withholds both panes from a collaborator-only client.
  interface Props {
    tab: 'providers' | 'connections';
    workspaceId?: WorkspaceId | null;
    /** Section anchor id to render alone (settings search); omitted renders the whole tab. */
    only?: string;
  }

  let { tab, workspaceId, only }: Props = $props();
  const shows = (id: string) => !only || only === id;
  const pluginsSupported$ = selectAgentPluginsSupported();
</script>

{#if tab === 'providers'}
  {#if shows('providers')}
    <div id="providers" data-highlight-id="providers" use:highlightTarget class="scroll-mt-20">
      <ProviderSelector />
    </div>
  {/if}
  {#if shows('utility-default-model')}
    <div
      id="utility-default-model"
      data-highlight-id="utility-default-model"
      use:highlightTarget
      class={only ? undefined : 'mt-10'}
    >
      <h2 class="type-title mb-3 text-foreground">
        {m.settings_section_defaults()}
      </h2>
      <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
        <section data-slot="settings-section-body" class="px-6 py-4">
          <DefaultAgentModelSettings {workspaceId} />
        </section>
        <section data-slot="settings-section-body" class="px-6 py-4">
          <h3 class="type-title mb-5 text-foreground">
            {m.settings_section_quickActions()}
          </h3>
          <BackgroundAgentSettings />
        </section>
      </div>
    </div>
  {/if}
{:else}
  {#if shows('integrations')}
    <div
      id="integrations"
      data-highlight-id="integrations"
      use:highlightTarget
      class="scroll-mt-20"
    >
      <h2 class="type-title mb-3 text-foreground">
        {m.settings_tab_accounts()}
      </h2>
      <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
        <section data-slot="settings-section-body" class="px-6 py-4">
          <ConnectionsSettings />
        </section>
      </div>
    </div>
  {/if}

  {#if shows('mcp-servers')}
    <div id="mcp-servers" data-highlight-id="mcp-servers" use:highlightTarget>
      <h2 class="type-title mb-3 text-foreground">
        {m.settings_section_mcpServers()}
      </h2>
      <McpServersSettings />
    </div>
  {/if}

  {#if $pluginsSupported$ && shows('plugins')}
    <div id="plugins" data-highlight-id="plugins" use:highlightTarget class="scroll-mt-20">
      <h2 class="type-title mb-3 text-foreground">
        {m.settings_section_plugins()}
      </h2>
      <PluginsSettings />
    </div>
  {/if}
{/if}
