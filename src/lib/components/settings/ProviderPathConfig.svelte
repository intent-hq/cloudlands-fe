<script lang="ts">
  /**
   * ProviderPathConfig
   *
   * A compact folder icon button that opens a dropdown portal for configuring
   * a provider's CLI executable path. Designed for the Integrations > Providers section.
   */
  import { appClient } from '$lib/client';
  import { faFolder, faCheck } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('ProviderPathConfig');

  interface Props {
    /** Provider ID (e.g., 'auggie', 'claude-code') */
    providerId: string;
    /** Provider display name */
    providerName: string;
    /**
     * CLI command name (e.g., 'auggie', 'claude-agent-acp') shown in the
     * placeholder text. Callers whose configured path resolves a different
     * binary than the provider's ACP runtime (e.g. unsloth, which configures
     * the `unsloth` CLI even though its ACP runtime is `opencode`) should
     * pass that binary's name here so the placeholder stays coherent with
     * `providerName` in the header.
     */
    cliCommand: string;
    /** Current configured path (empty if auto-detected) */
    configuredPath?: string;
    /** Auto-detected/resolved path */
    resolvedPath?: string;
    /**
     * Dual-binary providers only (unsloth): the secondary CLI's name
     * (e.g. 'unsloth'). Rendered alongside `secondaryResolvedPath`.
     */
    secondaryCliCommand?: string;
    /**
     * Dual-binary providers only: the daemon-resolved path of the secondary
     * CLI, when it resolved.
     */
    secondaryResolvedPath?: string;
    /** Whether the provider is currently installed */
    isInstalled?: boolean;
    /** Callback when path changes */
    onPathChange?: (path: string) => void;
  }

  // secondaryCliCommand / secondaryResolvedPath are accepted (typed above)
  // but not yet destructured — the dual-binary popup rendering lands in a
  // sibling change.
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

  async function savePath() {
    try {
      // The daemon owns provider path overrides (providers.paths, PROTOCOL
      // §5.12), keyed by provider id: host.checkAuggie reads
      // providers.paths.auggie, and ProviderSelector reads the same object
      // for its configured-path fields. The legacy settings:set IPC is not
      // bridged in this build.
      const entry = await appClient.settings.get('providers.paths');
      const existing =
        entry?.value && typeof entry.value === 'object' && !Array.isArray(entry.value)
          ? (entry.value as Record<string, unknown>)
          : {};
      await appClient.settings.update([
        { path: 'providers.paths', value: { ...existing, [providerId]: inputValue } },
      ]);
      onPathChange?.(inputValue);
      toast.success(m.settings_providerPath_saved());
      logger.info(`[ProviderPathConfig] Saved ${providerId} path:`, inputValue);
    } catch (error) {
      logger.error(`[ProviderPathConfig] Failed to save ${providerId} path:`, error);
      toast.error(m.settings_providerPath_saveError());
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
  const placeholderText = $derived(
    resolvedPath ? resolvedPath : m.settings_providerPath_placeholder({ command: cliCommand }),
  );
</script>

<DropdownMenu bind:open={dropdownOpen} align="end" side="bottom" portal={true}>
  {#snippet trigger({ toggle }: { toggle: () => void })}
    <button
      type="button"
      onclick={toggle}
      class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors cursor-pointer"
      title={m.settings_providerPath_configureTitle({ name: providerName })}
    >
      <Fa icon={faFolder} size={11} />
    </button>
  {/snippet}

  {#snippet content()}
    <div class="w-80 p-3 space-y-3 overflow-hidden">
      <!-- Header with helpful copy -->
      <div class="space-y-1">
        <p class="text-sm font-medium text-foreground">
          {m.settings_providerPath_header({ name: providerName })}
        </p>
        <p class="text-xs text-subtle">
          {#if isInstalled}
            {m.settings_providerPath_overrideHint()}
          {:else}
            {m.settings_providerPath_specifyHint_before()}
            <code class="px-1 py-0.5 bg-muted rounded text-ui">{cliCommand}</code>
            {m.settings_providerPath_specifyHint_after()}
          {/if}
        </p>
      </div>

      <!-- Path input -->
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
      </div>

      <!-- Status indicator -->
      {#if resolvedPath && !configuredPath}
        <p class="text-ui text-subtle flex items-center gap-1 min-w-0">
          <Fa icon={faCheck} class="text-green-500/70 shrink-0" size="xs" />
          <span class="shrink-0">{m.settings_providerPath_autoDetectedAt()}</span>
          <code class="px-1 py-0.5 bg-muted/50 rounded truncate min-w-0" title={resolvedPath}
            >{resolvedPath}</code
          >
        </p>
      {/if}
    </div>
  {/snippet}
</DropdownMenu>
