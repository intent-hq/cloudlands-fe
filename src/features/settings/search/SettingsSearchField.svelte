<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { effectiveShortcutReadable } from '$lib/utils/effective-shortcuts';
  import { matchesShortcut } from '$lib/utils/shortcut-bindings';
  import { isMacPlatform } from '$lib/utils/shortcuts';
  import { m } from '$shared/paraglide/messages.js';
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';

  let { value, onchange }: { value: string; onchange: (value: string) => void } = $props();

  let input: HTMLInputElement | undefined = $state();
  const isMac = isMacPlatform();
  const searchShortcut$ = effectiveShortcutReadable('global.search');

  function clear() {
    onchange('');
    input?.focus();
  }

  // The page owns Mod+F (the global search yields to a local handler that claims it).
  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || !matchesShortcut(event, $searchShortcut$, isMac)) return;
    event.preventDefault();
    input?.focus();
    input?.select();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="shrink-0 px-3 pb-3" data-settings-search>
  <div class="relative min-w-0">
    <MagnifyingGlassIcon
      size={14}
      aria-hidden="true"
      class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
    />
    <Input
      bind:ref={input}
      type="search"
      size="compact"
      {value}
      placeholder={m.settings_search_placeholder()}
      aria-label={m.settings_search_placeholder()}
      spellcheck={false}
      autocomplete="off"
      class="pr-7 pl-8 [&::-webkit-search-cancel-button]:appearance-none"
      oninput={(event) => onchange(event.currentTarget.value)}
      onkeydown={(event) => {
        if (event.key === 'Escape' && value) {
          event.preventDefault();
          event.stopPropagation();
          clear();
        }
      }}
    />
    {#if value}
      <Button
        variant="ghost"
        size="icon-compact"
        class="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
        aria-label={m.settings_search_clear_ariaLabel()}
        onclick={clear}
      >
        <XIcon size={12} aria-hidden="true" />
      </Button>
    {/if}
  </div>
</div>
