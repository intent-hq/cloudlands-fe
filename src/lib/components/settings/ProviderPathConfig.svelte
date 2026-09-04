<script lang="ts">
  /**
   * ProviderPathConfig
   *
   * A controlled dropdown panel for configuring a provider's CLI executable path.
   */
  import { appClient } from '$lib/client';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import * as Menu from '$lib/components/ui/menu';
  import PathSettingField from './PathSettingField.svelte';
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
     * overridable here. The note assumes the runtime binary name matches the
     * provider id whose configuration it follows (true for opencode); a
     * future dual-binary provider whose names diverge needs a separate
     * runtime provider id prop. The primary `cliCommand`/`resolvedPath` pair
     * always describes the binary the override input targets
     * (`providers.paths[providerId]`).
     */
    runtimeCliCommand?: string;
    /**
     * Dual-binary providers only: the daemon-resolved path of
     * `runtimeCliCommand`, when it resolved.
     */
    runtimeResolvedPath?: string;
    /**
     * npx-only providers only (claude-code, pi): the pinned package spec the
     * daemon launches via npx by default (e.g. `pkg@1.2.3`). For these
     * providers `resolvedPath` is the npx binary, not `cliCommand`, so the
     * status row describes the pinned npx launch instead of an auto-detected
     * `cliCommand`, and the hint explains that a configured path runs in
     * place of the pin (monorepo#4352).
     */
    npxPackage?: string;
    /** Whether the provider is currently installed */
    isInstalled?: boolean;
    /** Callback when path changes */
    onPathChange?: (path: string) => void;
    /** Controlled path dropdown state */
    open: boolean;
  }

  let {
    providerId,
    providerName,
    cliCommand,
    configuredPath = '',
    resolvedPath = '',
    runtimeCliCommand,
    runtimeResolvedPath,
    npxPackage,
    isInstalled = false,
    onPathChange,
    open = $bindable(),
  }: Props = $props();

  async function savePath(path: string) {
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
        { path: 'providers.paths', value: { ...existing, [providerId]: path } },
      ]);
      onPathChange?.(path);
      toast.success(m.settings_providerPath_saved());
      logger.info(`[ProviderPathConfig] Saved ${providerId} path:`, path);
    } catch (error) {
      logger.error(`[ProviderPathConfig] Failed to save ${providerId} path:`, error);
      toast.error(m.settings_providerPath_saveError());
    }
  }

  // Determine the display path (configured > resolved > placeholder). For
  // npx-only providers `resolvedPath` is npx, not the adapter the override
  // targets, so the placeholder names the adapter command instead.
  const placeholderText = $derived(
    resolvedPath && !npxPackage
      ? resolvedPath
      : m.settings_providerPath_placeholder({ command: cliCommand }),
  );

  // Remote daemons route browsing to the in-app DirectoryPickerModal, which
  // portals outside this menu; while it is open the menu must neither close
  // on outside interaction/Escape/focus loss nor unmount the subtree that
  // renders the modal.
  let pickerOpen = $state(false);

  // This panel is opened from the provider overflow menu, so bits-ui has no
  // trigger element to position against. An invisible custom anchor keeps the
  // floating content beside the overflow trigger instead of off-screen.
  let anchorEl = $state<HTMLElement | null>(null);
</script>

<Menu.Root
  bind:open={
    () => open,
    (next) => {
      // The remote picker modal lives inside this menu's subtree; refuse to
      // close (and unmount it) while the modal is open.
      if (!next && pickerOpen) return;
      open = next;
    }
  }
>
  <span bind:this={anchorEl} aria-hidden="true"></span>
  <Menu.Content
    align="end"
    side="bottom"
    portal={true}
    customAnchor={anchorEl}
    interactOutsideBehavior={pickerOpen ? 'ignore' : 'close'}
    escapeKeydownBehavior={pickerOpen ? 'ignore' : 'close'}
    onFocusOutside={(event) => {
      if (pickerOpen) event.preventDefault();
    }}
    aria-label={m.ui_dropdownMenu_ariaLabel()}
  >
    <div class="w-80 p-3 space-y-3 overflow-hidden">
      <!-- Header with helpful copy -->
      <div class="space-y-1">
        <p class="text-sm font-medium text-foreground">
          {m.settings_providerPath_header({ name: providerName })}
        </p>
        <p class="text-xs text-subtle">
          {#if npxPackage && resolvedPath}
            {m.settings_providerPath_npxOverrideHint_before({ package: npxPackage })}
            <code class="px-1 py-0.5 bg-muted rounded text-ui">{cliCommand}</code>
            {m.settings_providerPath_npxOverrideHint_after()}
          {:else if isInstalled}
            {m.settings_providerPath_overrideHint()}
          {:else}
            {m.settings_providerPath_specifyHint_before()}
            <code class="px-1 py-0.5 bg-muted rounded text-ui">{cliCommand}</code>
            {m.settings_providerPath_specifyHint_after()}
          {/if}
        </p>
      </div>

      <!-- Path picker: read-only field + file picker (native openFile locally,
           remote modal file mode otherwise); clear removes the override, same
           empty-value semantics as the old free-text input. -->
      <PathSettingField
        mode="file"
        value={configuredPath}
        placeholder={placeholderText}
        ariaLabel={m.settings_providerPath_header({ name: providerName })}
        pickerTitle={m.settings_providerPath_pickerTitle({ command: cliCommand })}
        onchange={savePath}
        bind:pickerOpen
      />

      <!-- Status indicator: full (wrapped) auto-detected paths; the primary
           row stays visible when an override is configured, marked as
           overridden. npx-only providers describe the pinned npx launch
           (the path is npx) instead of an auto-detected adapter. Dual-binary
           providers additionally get a read-only labeled runtime row that
           follows the runtime provider's own configuration. -->
      {#snippet autoDetectedRow(command: string | undefined, path: string, overridden: boolean)}
        <div class="text-ui text-subtle min-w-0">
          <p class="flex items-center gap-1 flex-wrap">
            <Fa
              icon={faCheck}
              class="{overridden ? 'text-ghost' : 'text-green-500/70'} shrink-0"
              size="xs"
            />
            <span>
              {#if npxPackage}
                {m.settings_providerPath_npxPinnedAt({ package: npxPackage })}
              {:else if command}
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
                {#if runtimeResolvedPath}
                  <Fa icon={faCheck} class="text-green-500/70 shrink-0" size="xs" />
                {/if}
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
  </Menu.Content>
</Menu.Root>
