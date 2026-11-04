<script lang="ts">
  import { onDestroy } from 'svelte';
  import { isDockShortcutId, type DockShortcutIssue } from '$shared/dock-shortcut-settings';
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
  import {
    applyShortcutCapture,
    shortcutFromKeyboardEvent,
    type ShortcutId,
  } from '$lib/utils/shortcut-bindings';
  import { formatShortcut, SHORTCUT_CATEGORIES, SHORTCUT_REGISTRY } from '$lib/utils/shortcuts';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectShortcutOverrides,
    selectDockShortcutSettings,
    selectDockShortcutPending,
    selectDockShortcutCaptureToken,
    selectDockShortcutError,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    dockShortcutCaptureRequested,
    resetAllShortcutOverrides,
    resetShortcutOverride,
    setShortcutOverride,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';

  const shortcutOverrides = selectShortcutOverrides();
  const dockSettings = selectDockShortcutSettings();
  const dockPending = selectDockShortcutPending();
  const captureToken = selectDockShortcutCaptureToken();
  const dockError = selectDockShortcutError();
  function issueText(issue: DockShortcutIssue) {
    if (issue.code === 'invalid') return m.settings_keyboardShortcuts_dockInvalid_error();
    if (issue.code === 'duplicate' || issue.code === 'app-conflict')
      return m.settings_keyboardShortcuts_dockConflict_error();
    if (issue.code === 'save-failed') return m.settings_keyboardShortcuts_dockSave_error();
    if (issue.code === 'stale') return m.settings_keyboardShortcuts_dockStale_error();
    if (issue.code === 'load-failed') return m.settings_keyboardShortcuts_dockLoad_error();
    return m.settings_keyboardShortcuts_dockUnavailable_error();
  }
  const hiddenShortcutIds = new Set<ShortcutId>([
    'chat.focus-input',
    'chat.mention-context',
    'editor.copy',
    'editor.select-all',
    'editor.undo',
    'editor.redo',
    'leader.resize-panels',
  ]);
  const fixedShortcutIds = new Set<ShortcutId>(['navigation.go-to-tab', 'leader.navigate-panels']);
  const categories = Object.entries(SHORTCUT_CATEGORIES).filter(
    ([, category]) => category.shortcuts.length > 0,
  );

  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  let capturing = $state<ShortcutId | null>(null);
  let captureWasReady = $state(false);
  let capturedValues = $state<Partial<Record<ShortcutId, string>>>({});

  function effectiveValue(id: ShortcutId, defaultKey: string) {
    return capturedValues[id] ?? $shortcutOverrides[id] ?? defaultKey;
  }

  function startCapture(id: ShortcutId) {
    if (capturing === id) return;
    captureWasReady = false;
    capturing = id;
    if ($dockSettings) appStore.dispatch(dockShortcutCaptureRequested(true));
  }

  function handleKeydown(event: KeyboardEvent, id: ShortcutId) {
    event.preventDefault();
    event.stopPropagation();
    if (capturing !== id || ($dockSettings && !$captureToken)) return;
    if (event.key === 'Escape') {
      capturing = null;
      (event.currentTarget as HTMLInputElement).blur();
      return;
    }
    const normalized = shortcutFromKeyboardEvent(event, isMac);
    if (!normalized) return;
    const binding = applyShortcutCapture(id, normalized);
    if (!isDockShortcutId(id)) capturedValues[id] = binding;
    appStore.dispatch(setShortcutOverride(id, binding));
    capturing = null;
    (event.currentTarget as HTMLInputElement).blur();
  }

  function cancelCapture(id: ShortcutId) {
    if ($dockSettings) appStore.dispatch(dockShortcutCaptureRequested(false));
    if (capturing === id) {
      capturing = null;
    }
  }

  $effect(() => {
    if (capturing && $captureToken) captureWasReady = true;
    // A new lease has no token until its IPC reply. Only retire a ready or failed capture.
    if (
      capturing &&
      $dockSettings &&
      !$dockPending &&
      !$captureToken &&
      (captureWasReady || $dockError)
    ) {
      const id = capturing;
      capturing = null;
      document.getElementById(`shortcut-${id}`)?.blur();
    }
  });

  onDestroy(() => {
    if ($captureToken) appStore.dispatch(dockShortcutCaptureRequested(false));
  });

  function resetRow(id: ShortcutId) {
    delete capturedValues[id];
    if (capturing === id) capturing = null;
    appStore.dispatch(resetShortcutOverride(id));
  }

  function resetAll() {
    capturedValues = {};
    capturing = null;
    appStore.dispatch(resetAllShortcutOverrides());
  }
</script>

<div class="flex flex-col gap-8">
  <div class="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2">
    {#each categories as [categoryId, category] (categoryId)}
      <section
        aria-labelledby={`keyboard-shortcuts-${categoryId}`}
        data-shortcut-category={categoryId}
      >
        <h3
          id={`keyboard-shortcuts-${categoryId}`}
          class="type-caption font-medium text-muted-foreground"
        >
          {category.title}
        </h3>
        {#if categoryId === 'dock'}
          <p class="mt-2 type-caption text-muted-foreground">
            {m.settings_keyboardShortcuts_dockGlobal_description()}
          </p>
          {#if $dockSettings && !$dockSettings.enabled}<p
              role="status"
              class="mt-2 type-caption text-muted-foreground"
            >
              {m.settings_keyboardShortcuts_dockOff_description()}
            </p>{/if}
          {#if $dockPending}<p role="status" class="mt-2 type-caption">
              {capturing
                ? m.settings_keyboardShortcuts_dockPreparing_status()
                : m.settings_keyboardShortcuts_dockSaving_status()}
            </p>{/if}
          {#if $dockError}<p role="alert" class="mt-2 type-caption text-destructive">
              {issueText($dockError)}
            </p>{/if}
          {#each ($dockSettings?.issues ?? []).filter((issue) => !issue.id) as issue}<p
              role="alert"
              class="mt-2 type-caption text-destructive"
            >
              {issueText(issue)}
            </p>{/each}
        {/if}
        <dl class="mt-3 space-y-2">
          {#each category.shortcuts as shortcut, index (`${shortcut.key}-${index}`)}
            {@const definition = SHORTCUT_REGISTRY.filter((entry) => entry.category === categoryId)[
              index
            ]}
            {#if definition && !hiddenShortcutIds.has(definition.id)}
              {@const isFixed = fixedShortcutIds.has(definition.id)}
              <div class="flex justify-between gap-4" data-shortcut-entry>
                <dt class="min-w-0 pt-1.5 type-body text-foreground">
                  <label for={`shortcut-${definition.id}`}>{shortcut.label}</label>
                </dt>
                <dd class="relative min-w-0 mr-4">
                  <Input
                    id={`shortcut-${definition.id}`}
                    class="h-7 w-28 bg-transparent px-2 type-body read-only:text-foreground read-only:hover:border-input focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:-outline-offset-2 {isFixed
                      ? 'read-only:bg-muted/20'
                      : 'read-only:bg-transparent'}"
                    type="text"
                    readonly
                    disabled={isDockShortcutId(definition.id) &&
                      (!$dockSettings || ($dockPending && capturing !== definition.id))}
                    aria-busy={isDockShortcutId(definition.id) && $dockPending}
                    data-shortcut-input
                    value={capturing === definition.id
                      ? ''
                      : formatShortcut(effectiveValue(definition.id, definition.defaultKey))}
                    placeholder={capturing === definition.id
                      ? $dockSettings && !$captureToken
                        ? m.settings_keyboardShortcuts_dockPreparing_status()
                        : m.settings_keyboardShortcuts_capture_placeholder()
                      : undefined}
                    onfocus={isFixed ? undefined : () => startCapture(definition.id)}
                    onclick={isFixed ? undefined : () => startCapture(definition.id)}
                    onblur={isFixed ? undefined : () => cancelCapture(definition.id)}
                    onkeydown={isFixed ? undefined : (event) => handleKeydown(event, definition.id)}
                  />
                  {#if !isFixed && definition.id in $shortcutOverrides}
                    <Button
                      variant="ghost-light"
                      size="icon-xs"
                      class="absolute top-0 left-full ml-1"
                      aria-label={m.settings_keyboardShortcuts_resetRow_ariaLabel({
                        label: shortcut.label,
                      })}
                      onclick={() => resetRow(definition.id)}
                    >
                      <span aria-hidden="true">×</span>
                    </Button>
                  {/if}
                  {#if isDockShortcutId(definition.id)}
                    {#each $dockSettings?.issues.filter((issue) => issue.id === definition.id) ?? [] as issue}
                      <p role="alert" class="mt-1 max-w-48 type-caption text-destructive">
                        {issueText(issue)}
                      </p>
                    {/each}
                  {/if}
                </dd>
              </div>
            {/if}
          {/each}
        </dl>
      </section>
    {/each}
  </div>

  <Button
    variant="outline"
    class="self-end mr-4"
    disabled={Object.keys($shortcutOverrides).length === 0}
    onclick={resetAll}
  >
    {m.settings_keyboardShortcuts_resetAll_button()}
  </Button>
</div>
