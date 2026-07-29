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
     * placeholder text. Always names the binary the override input targets:
     * the daemon applies `providers.paths[providerId]` when resolving the
     * provider's own CLI (for unsloth that is the `unsloth` CLI, not the
     * `opencode` ACP runtime it spawns).
     */
    cliCommand: string;
    /** Current configured path (empty if auto-detected) */
    configuredPath?: string;
    /** Auto-detected/resolved path */
    resolvedPath?: string;
    /**
     * Dual-binary providers only (unsloth): the name of the runtime binary
     * the provider spawns (e.g. 'opencode'). Rendered as a read-only labeled
     * runtime row with a note that it follows that provider's own
     * configuration (`providers.paths[runtimeCliCommand]`) — it is not
     * overridable here. The primary `cliCommand`/`resolvedPath` pair always
     * describes the binary the override input targets
     * (`providers.paths[providerId]`).
     */
    runtimeCliCommand?: string;
    /**
     * Dual-binary providers only: the daemon-resolved path of
     * `runtimeCliCommand`, when it resolved.
     */
    runtimeResolvedPath?: string;
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
    runtimeCliCommand,
    runtimeResolvedPath,
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

      <!-- Status indicator: full (wrapped) auto-detected paths; the primary
           row stays visible when an override is configured, marked as
           overridden. Dual-binary providers additionally get a read-only
           labeled runtime row that follows the runtime provider's own
           configuration. -->
      {#snippet autoDetectedRow(command: string | undefined, path: string, overridden: boolean)}
        <div class="text-ui text-subtle min-w-0">
          <p class="flex items-center gap-1 flex-wrap">
            <Fa
              icon={faCheck}
              class="{overridden ? 'text-ghost' : 'text-green-500/70'} shrink-0"
              size="xs"
            />
            <span>
              {#if command}
                {m.settings_providerPath_autoDetectedCommandAt({ command })}
              {:else}
                {m.settings_providerPath_autoDetectedAt()}
              {/if}
            </span>
            {#if overridden}
              <span class="italic text-ghost">{m.settings_providerPath_overriddenNote()}</span>
            {/if}
          </p>
          <code
            class="mt-0.5 block px-1 py-0.5 bg-muted/50 rounded break-all {overridden
              ? 'opacity-60'
              : ''}">{path}</code
          >
        </div>
      {/snippet}
      {#if resolvedPath || runtimeCliCommand}
        <div class="space-y-1.5">
          {#if resolvedPath}
            {@render autoDetectedRow(
              runtimeCliCommand ? cliCommand : undefined,
              resolvedPath,
              !!configuredPath,
            )}
          {/if}
          {#if runtimeCliCommand}
            <div class="text-ui text-subtle min-w-0">
              <p class="flex items-center gap-1 flex-wrap">
                <Fa
                  icon={faCheck}
                  class="{runtimeResolvedPath ? 'text-green-500/70' : 'text-ghost'} shrink-0"
                  size="xs"
                />
                <span>
                  {#if runtimeResolvedPath}
                    {m.settings_providerPath_runtimeCommandAt({ command: runtimeCliCommand })}
                  {:else}
                    {m.settings_providerPath_runtimeCommand({ command: runtimeCliCommand })}
                  {/if}
                </span>
                <span class="italic text-ghost">
                  {m.settings_providerPath_runtimeFollowsNote({ provider: runtimeCliCommand })}
                </span>
              </p>
              {#if runtimeResolvedPath}
                <code class="mt-0.5 block px-1 py-0.5 bg-muted/50 rounded break-all"
                  >{runtimeResolvedPath}</code
                >
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/snippet}
</DropdownMenu>
