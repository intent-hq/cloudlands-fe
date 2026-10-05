<script lang="ts">
  /**
   * ProviderPathConfig
   *
   * A controlled form popover for configuring a provider's CLI executable path.
   */
  import { onMount } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    providerPathSaveRequested,
    providerSettingsSessionOpened,
    providerSettingsSessionClosed,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import {
    selectProviderPaths,
    selectProviderSettingsSessionRequests,
  } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { Popover } from '$lib/components/patterns/settings/custom-controls';
  import PathSettingField from './PathSettingField.svelte';
  const sessionId = crypto.randomUUID();
  const requests$ = selectProviderSettingsSessionRequests(sessionId);
  const paths$ = selectProviderPaths();
  const saving = $derived($requests$.some((request) => request.status === 'pending'));
  let latestSave = $state<{ id: string; path: string } | null>(null);
  let deliveredRequestId: string | null = null;
  onMount(() => {
    appStore.dispatch(providerSettingsSessionOpened(sessionId));
    return () => appStore.dispatch(providerSettingsSessionClosed(sessionId));
  });

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
    /** Completion-only compatibility callback; persistence/refresh remain saga-owned. */
    onPathChange?: (path: string) => void;
    /** Controlled path form state */
    open: boolean;
    /** Overflow trigger that launched this form, used for anchoring and focus return. */
    anchor?: HTMLElement | null;
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
    anchor,
  }: Props = $props();

  function savePath(path: string) {
    const id = crypto.randomUUID();
    latestSave = { id, path };
    appStore.dispatch(providerPathSaveRequested(providerId, path, { id, sessionId }));
  }

  // Adapt the legacy completion callback only; no domain I/O or refresh lives here.
  $effect(() => {
    const save = latestSave;
    if (!save || deliveredRequestId === save.id) return;
    if ($requests$.find((request) => request.id === save.id)?.status !== 'success') return;
    deliveredRequestId = save.id;
    onPathChange?.(save.path);
  });

  // Determine the display path (configured > resolved > placeholder). For
  // npx-only providers `resolvedPath` is npx, not the adapter the override
  // targets, so the placeholder names the adapter command instead.
  const placeholderText = $derived(
    resolvedPath && !npxPackage
      ? resolvedPath
      : m.settings_providerPath_placeholder({ command: cliCommand }),
  );

  // Remote daemons route browsing to the in-app DirectoryPickerModal, which
  // portals outside this popover; while it is open the form must neither close
  // on outside interaction/Escape/focus loss nor unmount the subtree that
  // renders the modal.
  let pickerOpen = $state(false);
  let dismissedOutside = false;

  // This panel is opened from the provider overflow menu, so bits-ui has no
  // trigger element to position against. An invisible custom anchor keeps the
  // floating content beside the overflow trigger instead of off-screen.
  let anchorEl = $state<HTMLElement | null>(null);
</script>

<Popover.Root
  bind:open={
    () => open,
    (next) => {
      // The remote picker modal lives inside this popover's subtree; refuse to
      // close (and unmount it) while the modal is open.
      if (!next && pickerOpen) return;
      open = next;
    }
  }
>
  <span bind:this={anchorEl} aria-hidden="true"></span>
  <Popover.Content
    align="end"
    side="bottom"
    portal={true}
    role="dialog"
    trapFocus={false}
    customAnchor={anchor ?? anchorEl}
    interactOutsideBehavior={pickerOpen ? 'ignore' : 'close'}
    escapeKeydownBehavior={pickerOpen ? 'ignore' : 'close'}
    onOpenAutoFocus={() => (dismissedOutside = false)}
    onInteractOutside={() => {
      if (!pickerOpen) dismissedOutside = true;
    }}
    onFocusOutside={(event) => {
      if (pickerOpen) {
        event.preventDefault();
        return;
      }
      dismissedOutside = true;
      open = false;
    }}
    onCloseAutoFocus={(event) => {
      if (dismissedOutside) {
        event.preventDefault();
      } else if (anchor?.isConnected) {
        event.preventDefault();
        anchor.focus();
      }
    }}
    aria-label={m.settings_providerPath_header({ name: providerName })}
  >
    <div class="w-80 p-3 space-y-3 overflow-hidden" aria-busy={saving}>
      <!-- Header with helpful copy -->
      <div class="space-y-1">
        <p class="type-body font-medium text-foreground">
          {m.settings_providerPath_header({ name: providerName })}
        </p>
        <p class="type-body text-subtle">
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
        value={$paths$.configured[providerId] ?? configuredPath}
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
            class="mt-0.5 block rounded bg-muted/50 px-1 py-0.5 break-all {overridden
              ? 'text-muted-foreground'
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
  </Popover.Content>
</Popover.Root>
