<script lang="ts">
  import { slide } from 'svelte/transition';
  import type { McpServerWithStatus } from './types';
  import { serverToJson } from './types';
  import { findMatchingPreset } from './mcp-options';
  import McpIcon from './McpIcon.svelte';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import Dropdown from '$lib/components/ui/dropdown/Dropdown.svelte';
  import {
  faEllipsisV,
  faChevronDown,
  faPen,
  faCopy,
  faKey,
  faTrash,
  faRotateRight,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    server: McpServerWithStatus;
    onToggle: (name: string) => void;
    onEdit: (server: McpServerWithStatus) => void;
    onDelete: (name: string) => void;
    onReauthenticate?: (name: string) => void;
    onRestart?: (name: string) => void;
  }

  let { server, onToggle, onEdit, onDelete, onReauthenticate, onRestart }: Props = $props();

  // Statuses that represent a recoverable failure the user can retry/restart.
  const isRetryable = $derived(server.status === 'error' || server.status === 'stopped');

  // UI state
  let showTools = $state(false);
  let copySuccess = $state(false);

  // Status badge config: label, text color, bg color
  const statusBadges: Record<string, { label: string; class: string }> = {
    connected: {
      label: m.settings_mcp_status_connected(),
      class: 'text-green-700 dark:text-green-400 bg-green-500/10',
    },
    configured: {
      label: m.settings_mcp_status_ready(),
      class: 'text-blue-700 dark:text-blue-400 bg-blue-500/10',
    },
    disconnected: {
      label: m.settings_mcp_status_disconnected(),
      class: 'text-gray-600 dark:text-gray-400 bg-gray-500/10',
    },
    error: {
      label: m.settings_mcp_status_error(),
      class: 'text-red-700 dark:text-red-400 bg-red-500/10',
    },
    stopped: {
      label: m.settings_mcp_status_stopped(),
      class: 'text-orange-700 dark:text-orange-400 bg-orange-500/10',
    },
    auth_required: {
      label: m.settings_mcp_status_needsAuth(),
      class: 'text-amber-700 dark:text-amber-400 bg-amber-500/10',
    },
    disabled: {
      label: m.settings_mcp_status_disabled(),
      class: 'text-gray-500 dark:text-gray-500 bg-gray-500/10',
    },
  };

  // Match server to a known preset for icon/description
  const matchedPreset = $derived(findMatchingPreset(server.name));

  // Command display - show command or URL
  const displayCommand = $derived(() => {
    if (server.type === 'stdio') {
      const cmd = server.command || '';
      const args = server.args?.join(' ') || '';
      return args ? `${cmd} ${args}` : cmd;
    }
    return server.url || '';
  });

  // Dropdown options - use type: 'action' to prevent checkmarks
  const dropdownOptions = $derived([
    { type: 'action' as const, value: 'edit', label: m.settings_mcp_action_edit(), icon: faPen },
    { type: 'action' as const, value: 'copy', label: m.settings_mcp_action_copyJson(), icon: faCopy },
    ...(server.authType && server.authType !== 'none'
      ? [
          {
            type: 'action' as const,
            value: 'reauth',
            label: m.settings_mcp_action_reauthenticate(),
            icon: faKey,
          },
        ]
      : []),
    { type: 'separator' as const, value: 'sep', label: '' },
    {
      type: 'action' as const,
      value: 'delete',
      label: m.settings_mcp_action_delete(),
      icon: faTrash,
      class: 'text-destructive-foreground',
    },
  ]);

  function handleDropdownAction(value: string | string[]) {
    const action = Array.isArray(value) ? value[0] : value;
    switch (action) {
      case 'edit':
        onEdit(server);
        break;
      case 'copy':
        handleCopyJson();
        break;
      case 'reauth':
        onReauthenticate?.(server.name);
        break;
      case 'delete':
        onDelete(server.name);
        break;
    }
  }

  /**
   * Clean up raw MCP tool names for display.
   * - Strips trailing server name redundancy (e.g. `_figma` when server is `figma`)
   * - Replaces underscores/dashes with spaces
   * - Capitalizes first letter of each word
   */
  function formatToolName(toolName: string, serverName: string): string {
    let name = toolName;

    // Strip trailing server name suffix (case-insensitive)
    const normalizedServer = serverName.toLowerCase().replace(/[\s_-]/g, '');
    const suffixPattern = new RegExp(`[_-]${normalizedServer}$`, 'i');
    name = name.replace(suffixPattern, '');

    // Replace underscores and dashes with spaces, then title-case
    return name
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function handleCopyJson() {
    try {
      const json = serverToJson(server);
      await navigator.clipboard.writeText(json);
      copySuccess = true;
      setTimeout(() => (copySuccess = false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }
</script>

<div class="group">
  <!-- Main card row -->
  <div class="flex items-start justify-between gap-4 py-3">
    <!-- Left side: Icon + Server info -->
    <div class="flex items-start gap-3 min-w-0 flex-1">
      <!-- Icon: preset logo or generic server icon -->
      <div class="shrink-0 mt-0.5">
        {#if matchedPreset}
          <McpIcon iconName={matchedPreset.iconName} label={matchedPreset.label} size={20} />
        {:else}
          <McpIcon iconName="server" label={server.name} size={20} />
        {/if}
      </div>

      <!-- Server info -->
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="font-medium text-sm truncate" title={matchedPreset ? matchedPreset.label : server.name}>{matchedPreset ? matchedPreset.label : server.name}</span>
          {#if server.toolCount > 0}
            <span class="text-xs text-subtle">
              {server.toolCount === 1
                ? m.settings_mcp_toolCount_one()
                : m.settings_mcp_toolCount_many({ count: formatInteger(server.toolCount) })}
            </span>
          {/if}
          <!-- Status badge -->
          {#if statusBadges[server.status]}
            <span class="text-ui-sm px-1.5 py-0.5 rounded-full whitespace-nowrap {statusBadges[server.status].class}">{statusBadges[server.status].label}</span>
          {/if}
        </div>
        <p class="text-xs text-subtle truncate">{matchedPreset ? matchedPreset.description : displayCommand()}</p>

        <!-- Error / stopped message (shown inline when server has issues) -->
        {#if isRetryable && server.errorMessage}
          <p
            class="mt-1 text-xs line-clamp-2 {server.status === 'stopped'
              ? 'text-orange-600 dark:text-orange-400'
              : 'text-red-500 dark:text-red-400'}"
          >{server.errorMessage}</p>
        {:else if server.status === 'stopped'}
          <p class="mt-1 text-xs text-orange-600 dark:text-orange-400 line-clamp-2">
            {m.settings_mcp_serverStoppedMessage()}
          </p>
        {/if}

        <!-- Tools expansion (inline, only if has tools) -->
        {#if server.tools.length > 0}
          <button
            type="button"
            class="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1"
            onclick={() => (showTools = !showTools)}
          >
            <span>
              {showTools
                ? m.settings_mcp_hideTools({ count: formatInteger(server.tools.length) })
                : m.settings_mcp_showTools({ count: formatInteger(server.tools.length) })}
            </span>
            <div class="transition-transform duration-200 {showTools ? 'rotate-180' : ''}">
              <Fa icon={faChevronDown} size="xs" />
            </div>
          </button>
        {/if}
      </div>
    </div>

    <!-- Right side: Actions -->
    <div class="flex items-center gap-2 shrink-0">
      {#if server.status === 'auth_required' && onReauthenticate}
        <button
          type="button"
          class="px-2.5 py-1 text-xs font-medium rounded-md border border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 transition-colors cursor-pointer"
          onclick={() => onReauthenticate?.(server.name)}
        >
          {m.settings_mcp_authenticateButton()}
        </button>
      {:else if isRetryable && onRestart && !server.disabled}
        <button
          type="button"
          class="px-2.5 py-1 text-xs font-medium rounded-md border border-orange-500/50 text-orange-700 dark:text-orange-400 hover:bg-orange-500/10 transition-colors cursor-pointer flex items-center gap-1.5"
          onclick={() => onRestart?.(server.name)}
        >
          <Fa icon={faRotateRight} size="xs" />
          {m.settings_mcp_restartButton()}
        </button>
      {/if}
      <!-- Toggle switch -->
      <Switch
        checked={!server.disabled}
        onCheckedChange={() => onToggle(server.name)}
        size="sm"
      />

      <!-- Actions dropdown -->
      <Dropdown
        options={dropdownOptions}
        onchange={handleDropdownAction}
        variant="ghost"
        size="sm"
        searchable={false}
        portal={true}
        triggerClass="w-8 h-8 p-0! flex items-center justify-center"
      >
        {#snippet trigger()}
          <Fa icon={faEllipsisV} class="text-ghost" />
        {/snippet}
        {#snippet item({ option })}
          <div class="flex items-center gap-2 w-full {option.class || ''}">
            {#if option.icon}
              <Fa icon={option.icon} class="h-3.5 w-3.5 shrink-0 {option.class ? '' : 'opacity-50'}" />
            {/if}
            <span class="font-medium">{option.label}</span>
          </div>
        {/snippet}
      </Dropdown>
    </div>
  </div>

  <!-- Tools list (expanded) -->
  {#if showTools && server.tools.length > 0}
    <div transition:slide={{ duration: 200 }} class="pl-8 pb-2">
      <div class="max-h-60 overflow-y-auto space-y-1">
        {#each server.tools as tool (tool.name)}
          <div class="flex items-start gap-2 py-1">
            <div class="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0"></div>
            <div class="min-w-0 flex-1">
              <span class="text-sm font-medium">{formatToolName(tool.name, server.name)}</span>
              {#if tool.description}
                <p class="text-xs text-subtle line-clamp-2">{tool.description}</p>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<!-- Copy success toast -->
{#if copySuccess}
  <div
    class="fixed bottom-4 right-4 px-3 py-2 bg-green-600 text-white text-sm rounded-md shadow-lg z-50"
    transition:slide={{ duration: 150 }}
  >
    {m.settings_mcp_jsonCopied()}
  </div>
{/if}
