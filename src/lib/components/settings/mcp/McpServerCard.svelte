<script lang="ts">
  import { crispOut, springIn } from '$lib/motion';
  import type { McpServerWithStatus } from './types';
  import { serverToJson } from './types';
  import { findMatchingPreset } from './mcp-options';
  import McpIcon from './McpIcon.svelte';
  import { Button, Switch } from '$lib/components/patterns/settings/custom-controls';
  import { ListRow, RowActions, type ActionDefinition } from '$lib/components/patterns/collection';
  import {
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
    onReauthenticate: (name: string) => void;
    onRestart: (name: string) => void;
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
      class: 'text-warning-ink bg-warning/10',
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

  const quickActionCount = $derived(
    server.status === 'auth_required' || (isRetryable && !server.disabled) ? 1 : 0,
  );
  const rowActions = $derived.by((): ActionDefinition[] => [
    ...(server.status === 'auth_required'
      ? [{ id: 'authenticate', label: m.settings_mcp_authenticateButton(), icon: faKey }]
      : isRetryable && !server.disabled
        ? [{ id: 'restart', label: m.settings_mcp_restartButton(), icon: faRotateRight }]
        : []),
    { id: 'edit', label: m.settings_mcp_action_edit(), icon: faPen, group: 'manage' },
    { id: 'copy', label: m.settings_mcp_action_copyJson(), icon: faCopy, group: 'manage' },
    ...(server.authType && server.authType !== 'none'
      ? [
          {
            id: 'reauthenticate',
            label: m.settings_mcp_action_reauthenticate(),
            icon: faKey,
            group: 'manage',
          },
        ]
      : []),
    {
      id: 'delete',
      label: m.settings_mcp_action_delete(),
      icon: faTrash,
      destructive: true,
      group: 'danger',
    },
  ]);

  function handleRowAction(action: string) {
    switch (action) {
      case 'authenticate':
      case 'reauthenticate':
        onReauthenticate(server.name);
        break;
      case 'restart':
        onRestart(server.name);
        break;
      case 'edit':
        onEdit(server);
        break;
      case 'copy':
        handleCopyJson();
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
    return name.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

<div class="group/collection-row">
  <ListRow class="items-start px-1">
    {#snippet leading()}
      <div class="mt-0.5">
        {#if matchedPreset}
          <McpIcon iconName={matchedPreset.iconName} label={matchedPreset.label} size={20} />
        {:else}
          <McpIcon iconName="server" label={server.name} size={20} />
        {/if}
      </div>
    {/snippet}
    {#snippet title()}
      <span title={matchedPreset ? matchedPreset.label : server.name}
        >{matchedPreset ? matchedPreset.label : server.name}</span
      >
    {/snippet}
    {#snippet meta()}
      <span class="flex items-center gap-2">
        {#if server.toolCount > 0}
          <span class="text-xs text-subtle">
            {server.toolCount === 1
              ? m.settings_mcp_toolCount_one()
              : m.settings_mcp_toolCount_many({ count: formatInteger(server.toolCount) })}
          </span>
        {/if}
        <!-- Status badge -->
        {#if statusBadges[server.status]}
          <span
            class="text-ui-sm px-1.5 py-0.5 rounded-full whitespace-nowrap {statusBadges[
              server.status
            ].class}">{statusBadges[server.status].label}</span
          >
        {/if}
      </span>
    {/snippet}
    {#snippet description()}
      <div class="min-w-0">
        <p class="text-xs text-subtle truncate">
          {matchedPreset ? matchedPreset.description : displayCommand()}
        </p>

        <!-- Error / stopped message (shown inline when server has issues) -->
        {#if isRetryable && server.errorMessage}
          <p
            class="mt-1 text-xs line-clamp-2 {server.status === 'stopped'
              ? 'text-orange-600 dark:text-orange-400'
              : 'text-red-500 dark:text-red-400'}"
          >
            {server.errorMessage}
          </p>
        {:else if server.status === 'stopped'}
          <p class="mt-1 text-xs text-orange-600 dark:text-orange-400 line-clamp-2">
            {m.settings_mcp_serverStoppedMessage()}
          </p>
        {/if}

        <!-- Tools expansion (inline, only if has tools) -->
        {#if server.tools.length > 0}
          <Button
            variant="plain"
            size="xs"
            class="mt-1 h-auto text-xs text-muted-foreground hover:text-foreground"
            onclick={() => (showTools = !showTools)}
          >
            <span>
              {showTools
                ? m.settings_mcp_hideTools({ count: formatInteger(server.tools.length) })
                : m.settings_mcp_showTools({ count: formatInteger(server.tools.length) })}
            </span>
            <div
              class="transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {showTools
                ? ''
                : 'rotate-90'}"
            >
              <Fa icon={faChevronDown} size="xs" />
            </div>
          </Button>
        {/if}
      </div>
    {/snippet}
    {#snippet trailing()}
      <RowActions
        actions={rowActions}
        onAction={handleRowAction}
        visibleCount={quickActionCount}
        overflowLabel={m.settings_devices_actionsFor_ariaLabel({ name: server.name })}
      >
        {#snippet controls()}
          <div class="flex items-center">
            <Switch
              checked={!server.disabled}
              onCheckedChange={() => onToggle(server.name)}
              size="sm"
            />
          </div>
        {/snippet}
      </RowActions>
    {/snippet}
  </ListRow>

  <!-- Tools list (expanded) -->
  {#if showTools && server.tools.length > 0}
    <div
      in:springIn={{ tier: 'moderate', y: -4 }}
      out:crispOut={{ tier: 'moderate' }}
      class="pl-8 pb-2"
    >
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
    in:springIn={{ tier: 'fast', y: 4 }}
    out:crispOut={{ tier: 'fast' }}
  >
    {m.settings_mcp_jsonCopied()}
  </div>
{/if}
