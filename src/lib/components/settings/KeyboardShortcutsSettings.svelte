<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import {
    applyShortcutCapture,
    shortcutFromKeyboardEvent,
    type ShortcutId,
  } from '$lib/utils/shortcut-bindings';
  import { formatShortcut, SHORTCUT_CATEGORIES, SHORTCUT_REGISTRY } from '$lib/utils/shortcuts';
  import { m } from '$shared/paraglide/messages.js';
  import { selectShortcutOverrides } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    resetAllShortcutOverrides,
    resetShortcutOverride,
    setShortcutOverride,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';

  const shortcutOverrides = selectShortcutOverrides();
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
  let capturedValues = $state<Partial<Record<ShortcutId, string>>>({});

  function effectiveValue(id: ShortcutId, defaultKey: string) {
    return capturedValues[id] ?? $shortcutOverrides[id] ?? defaultKey;
  }

  function startCapture(id: ShortcutId) {
    capturing = id;
  }

  function handleKeydown(event: KeyboardEvent, id: ShortcutId) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      capturing = null;
      (event.currentTarget as HTMLInputElement).blur();
      return;
    }
    const normalized = shortcutFromKeyboardEvent(event, isMac);
    if (!normalized) return;
    const binding = applyShortcutCapture(id, normalized);
    capturedValues[id] = binding;
    appStore.dispatch(setShortcutOverride(id, binding));
    capturing = null;
    (event.currentTarget as HTMLInputElement).blur();
  }

  function cancelCapture(id: ShortcutId) {
    if (capturing === id) {
      capturing = null;
    }
  }

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
          class="text-xs font-medium text-muted-foreground uppercase tracking-wider"
        >
          {category.title}
        </h3>
        <dl class="mt-3 space-y-2">
          {#each category.shortcuts as shortcut, index (`${shortcut.key}-${index}`)}
            {@const definition = SHORTCUT_REGISTRY.filter((entry) => entry.category === categoryId)[
              index
            ]}
            {#if definition && !hiddenShortcutIds.has(definition.id)}
              {@const isFixed = fixedShortcutIds.has(definition.id)}
              <div class="flex justify-between gap-4" data-shortcut-entry>
                <dt class="min-w-0 pt-1.5 text-sm text-foreground">
                  <label for={`shortcut-${definition.id}`}>{shortcut.label}</label>
                </dt>
                <dd class="relative min-w-0 mr-4">
                  <Input
                    id={`shortcut-${definition.id}`}
                    class="h-7 w-28 bg-transparent px-2 text-xs read-only:text-foreground read-only:hover:border-input focus-visible:ring-2 focus-visible:ring-ring/40 {isFixed
                      ? 'read-only:bg-muted/20'
                      : 'read-only:bg-transparent'}"
                    type="text"
                    readonly
                    data-shortcut-input
                    value={capturing === definition.id
                      ? ''
                      : formatShortcut(effectiveValue(definition.id, definition.defaultKey))}
                    placeholder={capturing === definition.id
                      ? m.settings_keyboardShortcuts_capture_placeholder()
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
    class="self-start"
    disabled={Object.keys($shortcutOverrides).length === 0}
    onclick={resetAll}
  >
    {m.settings_keyboardShortcuts_resetAll_button()}
  </Button>
</div>
