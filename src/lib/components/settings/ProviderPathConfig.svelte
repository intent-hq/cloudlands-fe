<script lang="ts">
  /**
   * ProviderPathConfig
   *
   * A compact folder icon button that opens a dropdown portal for configuring
   * a provider's CLI executable path. Designed for the Integrations > Providers section.
   */
  import { invoke } from '$lib/electron-bridge';
  import {
  faFolder,
  faCheck,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { toast } from 'svelte-sonner';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('ProviderPathConfig');

  interface Props {
    /** Provider ID (e.g., 'auggie', 'claude-code') */
    providerId: string;
    /** Provider display name */
    providerName: string;
    /** CLI command name (e.g., 'auggie', 'claude-agent-acp') */
    cliCommand: string;
    /** Current configured path (empty if auto-detected) */
    configuredPath?: string;
    /** Auto-detected/resolved path */
    resolvedPath?: string;
    /** Whether the provider is currently installed */
    isInstalled?: boolean;
    /** Callback when path changes */
    onPathChange?: (path: string) => void;
  }

  let {
    providerId,
    providerName,
    cliCommand,
    configuredPath = '',
    resolvedPath = '',
    isInstalled = false,
    onPathChange,
  }: Props = $props();

  let dropdownOpen = $state(false);
  let inputValue = $state(configuredPath);

  // Sync input value when configuredPath changes
  $effect(() => {
    inputValue = configuredPath;
  });

  async function handleBrowse() {
    const result = await invoke<{
      data?: { canceled: boolean; filePaths?: string[] };
    }>('dialog:open', {
      directory: false,
      title: `Select ${providerName} Executable`,
      filters: [{ name: 'Executables', extensions: ['*'] }],
    });

    if (result?.data && !result.data.canceled && result.data.filePaths?.length) {
      inputValue = result.data.filePaths[0];
      await savePath();
    }
  }

  async function savePath() {
    try {
      // For auggie, use the existing settings:set IPC
      // For other providers, we'll need per-provider path storage
      const settingsKey = providerId === 'auggie' ? 'auggiePath' : `${providerId}Path`;
      await invoke('settings:set', { key: settingsKey, value: inputValue });
      onPathChange?.(inputValue);
      toast.success('Path saved');
      logger.info(`[ProviderPathConfig] Saved ${providerId} path:`, inputValue);
    } catch (error) {
      logger.error(`[ProviderPathConfig] Failed to save ${providerId} path:`, error);
      toast.error('Failed to save path');
    }
  }

  function handleBlur() {
    if (inputValue !== configuredPath) {
      savePath();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      savePath();
    }
  }

  // Determine the display path (configured > resolved > placeholder)
  const placeholderText = $derived(resolvedPath ? resolvedPath : `Path to ${cliCommand}`);
</script>

<DropdownMenu bind:open={dropdownOpen} align="end" side="bottom" portal={true}>
  {#snippet trigger({ toggle }: { toggle: () => void })}
    <button
      type="button"
      onclick={toggle}
      class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors cursor-pointer"
      title="Configure {providerName} path"
    >
      <Fa icon={faFolder} size={11} />
    </button>
  {/snippet}

  {#snippet content()}
    <div class="w-80 p-3 space-y-3 overflow-hidden">
      <!-- Header with helpful copy -->
      <div class="space-y-1">
        <p class="text-sm font-medium text-foreground">{providerName} CLI Path</p>
        <p class="text-xs text-subtle">
          {#if isInstalled}
            Override the auto-detected path if needed.
          {:else}
            Specify the path to the <code class="px-1 py-0.5 bg-muted rounded text-ui"
              >{cliCommand}</code
            > executable.
          {/if}
        </p>
      </div>

      <!-- Path input with browse button -->
      <div class="flex gap-2">
        <input
          type="text"
          bind:value={inputValue}
          onblur={handleBlur}
          onkeydown={handleKeydown}
          placeholder={placeholderText}
          class="flex-1 px-2.5 py-1.5 bg-background border border-border rounded-md text-xs text-foreground
            placeholder:text-muted-foreground/60 transition-all
            focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
        <Button variant="secondary" size="sm" onclick={handleBrowse} class="shrink-0 px-2.5">
          <Fa icon={faFolder} size="sm" />
        </Button>
      </div>

      <!-- Status indicator -->
      {#if resolvedPath && !configuredPath}
        <p class="text-ui text-subtle flex items-center gap-1 min-w-0">
          <Fa icon={faCheck} class="text-green-500/70 shrink-0" size="xs" />
          <span class="shrink-0">Auto-detected at</span>
          <code class="px-1 py-0.5 bg-muted/50 rounded truncate min-w-0" title={resolvedPath}
            >{resolvedPath}</code
          >
        </p>
      {/if}
    </div>
  {/snippet}
</DropdownMenu>
