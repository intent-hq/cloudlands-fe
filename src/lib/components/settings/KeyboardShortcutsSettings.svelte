<script lang="ts">
  import { Button } from '$lib/components/ui/button';
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
            {#if definition}
              <div
                class="grid grid-cols-[minmax(0,1fr)_9rem] items-start gap-4"
                data-shortcut-entry
              >
                <dt class="min-w-0 pt-1.5 text-sm text-foreground">
                  <label for={`shortcut-${definition.id}`}>{shortcut.label}</label>
                </dt>
                <dd class="relative min-w-0">
                  <input
                    id={`shortcut-${definition.id}`}
                    class="h-7 w-36 rounded-md border border-border bg-transparent px-2 text-xs text-foreground outline-none transition-[border-color,box-shadow] duration-(--motion-fast) hover:border-input focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:opacity-60 disabled:hover:border-border aria-invalid:border-destructive-foreground aria-invalid:ring-1 aria-invalid:ring-destructive-foreground/25 motion-reduce:transition-none"
                    type="text"
                    readonly
                    data-shortcut-input
                    value={capturing === definition.id
                      ? ''
                      : formatShortcut(effectiveValue(definition.id, definition.defaultKey))}
                    placeholder={capturing === definition.id
                      ? m.settings_keyboardShortcuts_capture_placeholder()
                      : undefined}
                    onfocus={() => startCapture(definition.id)}
                    onclick={() => startCapture(definition.id)}
                    onblur={() => cancelCapture(definition.id)}
                    onkeydown={(event) => handleKeydown(event, definition.id)}
                  />
                  {#if definition.id in $shortcutOverrides}
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
