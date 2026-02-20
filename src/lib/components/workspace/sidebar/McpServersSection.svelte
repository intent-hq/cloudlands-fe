<script lang="ts">
  /**
   * McpServersSection - Displays user-defined MCP servers with toggles
   *
   * Shows MCP servers from ~/.augment/settings.json and allows users
   * to enable/disable individual servers per workspace.
   */
  import { mcpServersStore, type McpServerInfo } from '$features/mcp/mcp-servers.store.svelte';
  import { slide } from 'svelte/transition';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import {
    faChevronDown,
    faChevronRight,
    faGear,
    faPlug,
    faTerminal,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';

  interface Props {
    workspaceId: string;
    class?: string;
  }

  let { workspaceId, class: className }: Props = $props();

  // Collapse state
  let isExpanded = $state(false);

  // Track favicon load errors to show fallback
  let faviconErrors = $state<Record<string, boolean>>({});

  // Initialize store for this workspace and load servers
  $effect(() => {
    if (workspaceId) {
      mcpServersStore.setWorkspace(workspaceId);
      mcpServersStore.loadServers();
    }
  });

  // Derived values from store
  const servers = $derived(mcpServersStore.servers);

  /**
   * Extract the root domain (apex domain) from a hostname.
   * e.g., "api.ref.tools" -> "ref.tools", "mcp.render.com" -> "render.com"
   */
  function getRootDomain(hostname: string): string {
    const parts = hostname.split('.');
    // Handle cases like "localhost" or simple domains
    if (parts.length <= 2) return hostname;
    // Return last two parts (e.g., "ref.tools" from "api.ref.tools")
    return parts.slice(-2).join('.');
  }

  /**
   * Get favicon URL for a server.
   * Uses Google's favicon service with the root domain for better results.
   */
  function getFaviconUrl(server: McpServerInfo): string | null {
    if (!server.url) return null;

    try {
      const url = new URL(server.url);
      const rootDomain = getRootDomain(url.hostname);
      // Use Google's favicon service - it's reliable and handles most cases
      return `https://www.google.com/s2/favicons?domain=${rootDomain}&sz=32`;
    } catch {
      return null;
    }
  }

  // Get description for server type
  function getServerTypeLabel(server: McpServerInfo): string {
    switch (server.type) {
      case 'http':
        return 'HTTP';
      case 'sse':
        return 'SSE';
      case 'command':
        return 'Command';
      default:
        return 'Unknown';
    }
  }

  function handleToggle(serverName: string, enabled: boolean) {
    mcpServersStore.toggleServer(serverName, enabled);
  }

  function handleFaviconError(serverName: string) {
    faviconErrors = { ...faviconErrors, [serverName]: true };
  }
</script>

{#if servers.length > 0}
  <div class="mt-3 {className ?? ''}">
    <!-- Section Header -->
    <button
      type="button"
      class="w-full flex items-center gap-2 px-1.5 py-1 text-xs font-medium text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
      onclick={() => (isExpanded = !isExpanded)}
    >
      <Fa icon={faChevronDown} size="xs" class="opacity-50 transition-transform duration-200 {isExpanded ? '' : '-rotate-90'}" />
      <!-- <Fa icon={faPlug} size="xs" class="opacity-70" /> -->
      <span>MCP Servers</span>
      <span class="ml-auto text-[10px] opacity-60">{servers.filter((s) => mcpServersStore.isServerEnabled(s.name)).length} enabled</span>
    </button>

    {#if isExpanded}
      <div class="space-y-0.5 mt-1 pl-4" transition:slide={{ axis: 'y', duration: 200 }}>
        {#each servers as server (server.name)}
          {@const isEnabled = mcpServersStore.isServerEnabled(server.name)}
          {@const faviconUrl = getFaviconUrl(server)}
          {@const showFallback = !faviconUrl || faviconErrors[server.name]}
          <div
            class="flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors group"
          >
            <!-- Server Icon - Favicon for HTTP/SSE, terminal icon for command -->
            <div
              class="size-3.5 rounded flex items-center justify-center shrink-0 {isEnabled
                ? ''
                : 'opacity-50'}"
            >
              {#if server.type === 'command' || showFallback}
                <Fa
                  icon={server.type === 'command' ? faTerminal : faPlug}
                  size="xs"
                  class={isEnabled ? 'text-primary' : 'text-muted-foreground/50'}
                />
              {:else if faviconUrl}
                <img
                  src={faviconUrl}
                  alt="{server.name} icon"
                  class="size-3.5"
                  onerror={() => handleFaviconError(server.name)}
                />
              {/if}
            </div>

            <!-- Server Name & Type -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span
                  class="text-sm truncate {isEnabled
                    ? 'text-foreground'
                    : 'text-muted-foreground'}"
                >
                  {server.name}
                </span>
                <!-- <span
                  class="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-medium"
                >
                  {getServerTypeLabel(server)}
                </span> -->
              </div>
              <!-- {#if server.url}
                <Tooltip content={server.url} side="bottom" delayDuration={500}>
                  <p class="text-[10px] text-muted-foreground/60 truncate max-w-[180px]">
                    {server.url}
                  </p>
                </Tooltip>
              {:else if server.command}
                <Tooltip content={server.command} side="bottom" delayDuration={500}>
                  <p class="text-[10px] text-muted-foreground/60 truncate max-w-[180px]">
                    {server.command}
                  </p>
                </Tooltip>
              {/if} -->
            </div>

            <!-- Toggle Switch -->
            <Switch
              size="sm"
              checked={isEnabled}
              onCheckedChange={(checked) => handleToggle(server.name, checked)}
              ariaLabel={`Toggle ${server.name} MCP server`}
            />
          </div>
        {/each}

        <!-- Manage Servers Button -->
        <button
          type="button"
          class="w-full flex items-center gap-1.5 px-2 py-1.5 mt-1 text-sm text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-pointer"
          onclick={() => navigateToSettings({ hash: 'mcp-servers' })}
        >
          <Fa icon={faGear} size={13} class="opacity-50 mx-[2px]" />
          <span>Manage servers</span>
        </button>
      </div>
    {/if}
  </div>
{/if}
