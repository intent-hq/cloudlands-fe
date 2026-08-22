<script lang="ts">
  /**
   * ProviderPathConfig
   *
   * A dropdown panel for configuring a provider's CLI executable path. It can
   * render its default folder trigger or be controlled by a parent menu.
   */
  import { appClient } from '$lib/client';
  import { faFolder, faCheck } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import * as Menu from '$lib/components/ui/menu';
  import { Button } from '$lib/components/ui/button';
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
    /** Whether the provider is currently installed */
    isInstalled?: boolean;
    /** Callback when path changes */
    onPathChange?: (path: string) => void;
    /** Whether the path dropdown is open */
    open?: boolean;
    /** Whether to render the default folder trigger */
    showTrigger?: boolean;
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
    open = $bindable(false),
    showTrigger = true,
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

  // Determine the display path (configured > resolved > placeholder)
  const placeholderText = $derived(
    resolvedPath ? resolvedPath : m.settings_providerPath_placeholder({ command: cliCommand }),
  );

  // Remote daemons route browsing to the in-app DirectoryPickerModal, which
  // portals outside this menu; while it is open the menu must neither close
  // on outside interaction/Escape/focus loss nor unmount the subtree that
  // renders the modal.
  let pickerOpen = $state(false);

  // When the parent controls this menu without rendering the trigger
  // (showTrigger=false), bits-ui's floating layer has no anchor element and
  // positions the content off-screen. Render an invisible anchor in the
  // trigger's place and hand it to Menu.Content as customAnchor.
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
  {#if showTrigger}
    <Menu.Trigger>
      {#snippet child({ props })}
        <span class="contents" {...props}>
          <Button
            variant="ghost-light"
            size="icon-xs"
            tooltip={m.settings_providerPath_configureTitle({ name: providerName })}
            title={m.settings_providerPath_configureTitle({ name: providerName })}
            aria-label={m.settings_providerPath_configureTitle({ name: providerName })}
          >
            <Fa icon={faFolder} size={11} />
          </Button>
        </span>
      {/snippet}
    </Menu.Trigger>
  {:else}
    <span bind:this={anchorEl} aria-hidden="true"></span>
  {/if}
  <Menu.Content
    align="end"
    side="bottom"
    portal={true}
    customAnchor={showTrigger ? null : anchorEl}
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
          {#if isInstalled}
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
