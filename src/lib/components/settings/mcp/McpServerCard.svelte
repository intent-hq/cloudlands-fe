<script lang="ts">
  import { slide } from 'svelte/transition';
  import type { McpServerWithStatus } from './types';
  import { serverToJson } from './types';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import Dropdown from '$lib/components/ui/dropdown/Dropdown.svelte';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { faEllipsisV, faChevronDown, faPen, faCopy, faKey, faTrash } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    server: McpServerWithStatus;
    onToggle: (name: string) => void;
    onEdit: (server: McpServerWithStatus) => void;
    onDelete: (name: string) => void;
    onReauthenticate?: (name: string) => void;
  }

  let { server, onToggle, onEdit, onDelete, onReauthenticate }: Props = $props();

  // UI state
  let showTools = $state(false);
  let copySuccess = $state(false);

  // Status color mapping
  const statusColors: Record<string, string> = {
    connected: 'bg-green-500',
    disconnected: 'bg-gray-400',
    error: 'bg-red-500',
    auth_required: 'bg-yellow-500',
    disabled: 'bg-transparent border-2 border-gray-400',
  };

  // Status tooltip text
  const statusTooltips = $derived<Record<string, string>>({
    connected: 'Connected',
    disconnected: 'Disconnected',
    error: server.errorMessage || 'Connection error',
    auth_required: 'Authentication required',
    disabled: 'Disabled',
  });

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
    { type: 'action' as const, value: 'edit', label: 'Edit', icon: faPen },
    { type: 'action' as const, value: 'copy', label: 'Copy JSON', icon: faCopy },
    ...(server.authType && server.authType !== 'none'
      ? [{ type: 'action' as const, value: 'reauth', label: 'Reauthenticate', icon: faKey }]
      : []),
    { type: 'separator' as const, value: 'sep', label: '' },
    { type: 'action' as const, value: 'delete', label: 'Delete', icon: faTrash, class: 'text-destructive' },
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
    <!-- Left side: Status + Server info -->
    <div class="flex items-start gap-3 min-w-0 flex-1">
      <!-- Status indicator with tooltip -->
      <Tooltip content={statusTooltips[server.status]} side="right">
        <div class="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5 {statusColors[server.status]}"></div>
      </Tooltip>

      <!-- Server info -->
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="font-medium text-sm truncate">{server.name}</span>
          {#if server.toolCount > 0}
            <span class="text-xs text-muted-foreground">({server.toolCount}) tools</span>
          {/if}
        </div>
        <p class="text-xs text-muted-foreground truncate">{displayCommand()}</p>

        <!-- Error message (shown inline when server failed to start) -->
        {#if server.status === 'error' && server.errorMessage}
          <p class="mt-1 text-xs text-red-500 dark:text-red-400 line-clamp-2">{server.errorMessage}</p>
        {/if}

        <!-- Tools expansion (inline, only if has tools) -->
        {#if server.tools.length > 0}
          <button
            type="button"
            class="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1"
            onclick={() => (showTools = !showTools)}
          >
            <span>{showTools ? 'Hide' : 'Show'} {server.tools.length} tools</span>
            <div class="transition-transform duration-200 {showTools ? 'rotate-180' : ''}">
              <Fa icon={faChevronDown} size="xs" />
            </div>
          </button>
        {/if}
      </div>
    </div>

    <!-- Right side: Actions -->
    <div class="flex items-center gap-2 shrink-0">
      <!-- Authenticate button for auth_required status -->
      {#if server.status === 'auth_required'}
        <button
          type="button"
          class="px-3 py-1 text-xs font-medium rounded-md border border-yellow-500 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10 transition-colors"
          onclick={() => onReauthenticate?.(server.name)}
        >
          Authenticate
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
          <Fa icon={faEllipsisV} class="text-muted-foreground" />
        {/snippet}
        {#snippet item({ option })}
          <div class="flex items-center gap-2 w-full {option.class || ''}">
            {#if option.icon}
              <Fa icon={option.icon} class="h-3.5 w-3.5 shrink-0 opacity-50" />
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
              <span class="text-sm font-medium">{tool.name}</span>
              {#if tool.description}
                <p class="text-xs text-muted-foreground line-clamp-2">{tool.description}</p>
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
    JSON copied to clipboard!
  </div>
{/if}
