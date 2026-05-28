<script lang="ts">
  /**
   * McpServersSection - Displays user-defined MCP servers with toggles
   *
   * Shows MCP servers from ~/.augment/settings.json and allows users
   * to enable/disable individual servers per workspace.
   */
  import { writable } from 'svelte/store';
  import type { McpServerConfig } from '$lib/store/slices/mcp-settings/mcp-settings-types';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import {
  loadServers,
  toggleWorkspaceMcpServer,
} from '$lib/store/slices/mcp-settings/mcp-settings-slice';
  import {
  selectMcpServers,
  selectMcpErrorMessages,
  selectWorkspaceDisabledMcpServerNamesByWorkspaceId,
} from '$lib/store/slices/mcp-settings/mcp-settings-selectors';
  import { slide } from 'svelte/transition';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import {
  faChevronDown,
  faExclamationTriangle,
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

  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  // ✅ At component init — these use getContext() internally
  const dispatch = getDispatch();
  const servers$ = selectMcpServers();
  const disabledServerNames$ = selectWorkspaceDisabledMcpServerNamesByWorkspaceId(workspaceIdStore);
  const serverErrors$ = selectMcpErrorMessages();

  type McpServerRow = {
    server: McpServerConfig;
    enabled: boolean;
    error?: string;
  };

  const serverRows = $derived<McpServerRow[]>(
    $servers$.map((server) => ({
      server,
      enabled: !$disabledServerNames$.includes(server.name),
      error: $serverErrors$[server.name],
    })),
  );
  const enabledServerCount = $derived(serverRows.filter((row) => row.enabled).length);

  // Collapse state
  let isExpanded = $state(false);

  // Track favicon load errors to show fallback
  let faviconErrors = $state<Record<string, boolean>>({});

  // Load servers on workspace change
  let lastInitWorkspaceId: string | undefined;
  $effect(() => {
    if (workspaceId && workspaceId !== lastInitWorkspaceId) {
      lastInitWorkspaceId = workspaceId;
      dispatch(loadServers());
    }
  });

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
  function getFaviconUrl(server: McpServerConfig): string | null {
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

  function handleToggle(serverName: string, enabled: boolean) {
    dispatch(toggleWorkspaceMcpServer(workspaceId, serverName, enabled));
  }

  function handleFaviconError(serverName: string) {
    faviconErrors = { ...faviconErrors, [serverName]: true };
  }
</script>

{#if serverRows.length > 0}
  <div class="mt-3 {className ?? ''}">
    <!-- Section Header -->
    <button
      type="button"
      class="w-full flex items-center gap-2 px-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      onclick={() => (isExpanded = !isExpanded)}
    >
      <Fa icon={faChevronDown} size="xs" class="opacity-50 transition-transform duration-200 {isExpanded ? '' : '-rotate-90'}" />
      <!-- <Fa icon={faPlug} size="xs" class="opacity-70" /> -->
      <span>MCP Servers</span>
      <span class="ml-auto text-ui opacity-60">{enabledServerCount} enabled</span>
    </button>

    {#if isExpanded}
      <div class="space-y-0.5 mt-1 pl-4" transition:slide={{ axis: 'y', duration: 200 }}>
        {#each serverRows as { server, enabled, error } (server.name)}
          {@const isEnabled = enabled}
          {@const serverError = error}
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
              {#if server.type === 'stdio' || showFallback}
                <Fa
                  icon={server.type === 'stdio' ? faTerminal : faPlug}
                  size="xs"
                  class={isEnabled ? 'text-primary' : 'text-muted-foreground'}
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
                    : 'text-subtle'}"
                >
                  {server.name}
                </span>
                {#if serverError && isEnabled}
                  <Tooltip content={serverError} side="right" delayDuration={200}>
                    <Fa icon={faExclamationTriangle} size="xs" class="text-red-500 shrink-0" />
                  </Tooltip>
                {/if}
              </div>
              <!-- {#if server.url}
                <Tooltip content={server.url} side="bottom" delayDuration={500}>
                  <p class="text-xs text-subtle truncate max-w-[180px]">
                    {server.url}
                  </p>
                </Tooltip>
              {:else if server.command}
                <Tooltip content={server.command} side="bottom" delayDuration={500}>
                  <p class="text-xs text-subtle truncate max-w-[180px]">
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
          class="w-full flex items-center gap-1.5 px-2 py-1.5 mt-1 text-sm text-muted-foreground hover:text-muted-foreground transition-colors cursor-pointer"
          onclick={() => navigateToSettings({ hash: 'mcp-servers' })}
        >
          <Fa icon={faGear} size={13} class="opacity-50 mx-[2px]" />
          <span>Manage servers</span>
        </button>
      </div>
    {/if}
  </div>
{/if}
