<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { normalizeShortcut, type ShortcutId } from '$lib/utils/shortcut-bindings';
  import { SHORTCUT_CATEGORIES, SHORTCUT_REGISTRY } from '$lib/utils/shortcuts';
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

  let drafts = $state<Partial<Record<ShortcutId, string>>>({});
  let errors = $state<Partial<Record<ShortcutId, boolean>>>({});

  function effectiveValue(id: ShortcutId, defaultKey: string) {
    return drafts[id] ?? $shortcutOverrides[id] ?? defaultKey;
  }

  function updateDraft(id: ShortcutId, value: string) {
    drafts[id] = value;
    delete errors[id];
  }

  function commit(id: ShortcutId) {
    const draft = drafts[id];
    if (draft === undefined) return;
    const normalized = normalizeShortcut(draft);
    if (!normalized) {
      errors[id] = true;
      return;
    }
    appStore.dispatch(setShortcutOverride(id, normalized));
    drafts[id] = normalized;
    delete errors[id];
  }

  function restoreEffective(id: ShortcutId) {
    delete drafts[id];
    delete errors[id];
  }

  function handleKeydown(event: KeyboardEvent, id: ShortcutId) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      restoreEffective(id);
      (event.currentTarget as HTMLInputElement).blur();
    }
  }

  function resetRow(id: ShortcutId) {
    restoreEffective(id);
    appStore.dispatch(resetShortcutOverride(id));
  }

  function resetAll() {
    drafts = {};
    errors = {};
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
              {@const errorId = `shortcut-${definition.id}-error`}
              <div class="flex items-start justify-between gap-4" data-shortcut-entry>
                <dt class="min-w-0 pt-1.5 text-sm text-foreground">
                  <label for={`shortcut-${definition.id}`}>{shortcut.label}</label>
                </dt>
                <dd class="flex min-w-0 flex-col items-end gap-1">
                  <div class="flex items-center gap-1">
                    <input
                      id={`shortcut-${definition.id}`}
                      class="h-7 w-36 rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      type="text"
                      data-shortcut-input
                      value={effectiveValue(definition.id, definition.defaultKey)}
                      aria-invalid={errors[definition.id] || undefined}
                      aria-describedby={errors[definition.id] ? errorId : undefined}
                      oninput={(event) => updateDraft(definition.id, event.currentTarget.value)}
                      onblur={() => commit(definition.id)}
                      onkeydown={(event) => handleKeydown(event, definition.id)}
                    />
                    {#if definition.id in $shortcutOverrides}
                      <Button
                        variant="ghost-light"
                        size="icon-xs"
                        aria-label={m.settings_keyboardShortcuts_resetRow_ariaLabel({
                          label: shortcut.label,
                        })}
                        onclick={() => resetRow(definition.id)}
                      >
                        <span aria-hidden="true">×</span>
                      </Button>
                    {/if}
                  </div>
                  {#if errors[definition.id]}
                    <p
                      id={errorId}
                      role="alert"
                      class="max-w-52 text-right text-xs text-destructive"
                    >
                      {m.settings_keyboardShortcuts_invalid_error()}
                    </p>
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
