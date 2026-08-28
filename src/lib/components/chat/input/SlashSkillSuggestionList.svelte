<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import type { SkillInfo } from '$store/renderer/slices/skills/skills-types';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    items?: readonly SkillInfo[];
    loading?: boolean;
    error?: string | null;
    onSelect: (skill: SkillInfo) => void;
    onDismiss?: () => void;
  }

  let { items = [], loading = false, error = null, onSelect, onDismiss }: Props = $props();

  const componentId = $props.id();
  let selectedIndex = $state(0);
  let listElement = $state<HTMLDivElement>();

  const selectedOptionId = $derived(
    items.length > 0 ? `${componentId}-option-${selectedIndex}` : undefined,
  );

  $effect(() => {
    items;
    loading;
    error;
    selectedIndex = 0;
  });

  function scrollToSelected() {
    listElement
      ?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }

  function moveSelection(delta: number) {
    if (items.length === 0) return;
    selectedIndex = (selectedIndex + delta + items.length) % items.length;
    scrollToSelected();
  }

  function selectItem(index: number) {
    const item = items[index];
    if (item) onSelect(item);
  }

  function handleKeyDown(event: KeyboardEvent): boolean {
    switch (event.key) {
      case 'ArrowUp':
        if (items.length === 0) return false;
        event.preventDefault();
        event.stopPropagation();
        moveSelection(-1);
        return true;
      case 'ArrowDown':
        if (items.length === 0) return false;
        event.preventDefault();
        event.stopPropagation();
        moveSelection(1);
        return true;
      case 'Enter':
        if (items.length === 0) return false;
        event.preventDefault();
        event.stopPropagation();
        selectItem(selectedIndex);
        return true;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onDismiss?.();
        return true;
      default:
        return false;
    }
  }

  function onKeyDown({ event }: { event: KeyboardEvent }): boolean {
    return handleKeyDown(event);
  }

  export { onKeyDown };
</script>

<div
  class="slash-skill-suggestion-list w-full max-w-72 overflow-hidden rounded-(--radius-medium) border border-border bg-popover text-popover-foreground shadow-(--elevation-overlay)"
>
  {#if loading}
    <div class="slash-skill-state" role="status" aria-live="polite">
      {m.chat_slashSkillSuggestionList_loading_label()}
    </div>
  {:else if error}
    <div class="slash-skill-state" role="alert">
      {m.chat_slashSkillSuggestionList_loadFailed_label()}
    </div>
  {:else if items.length === 0}
    <div class="slash-skill-state" role="status">
      {m.chat_slashSkillSuggestionList_noResults_label()}
    </div>
  {:else}
    <div
      class="slash-skill-options"
      role="listbox"
      aria-label={m.chat_slashSkillSuggestionList_ariaLabel()}
      aria-activedescendant={selectedOptionId}
      tabindex="-1"
      bind:this={listElement}
      onkeydown={handleKeyDown}
    >
      {#each items as item, index (`${item.name}:${item.location}`)}
        <Tooltip content={item.description} side="right" align="start" class="w-full">
          <Button
            type="button"
            id={`${componentId}-option-${index}`}
            variant="ghost"
            size="sm"
            class={`slash-skill-option h-auto w-full justify-start rounded-none border-0 bg-transparent px-2 py-1.5 text-left text-inherit shadow-none hover:border-0 hover:text-inherit focus-visible:border-0 focus-visible:ring-0 active:border-0 ${selectedIndex === index ? 'active' : ''}`}
            role="option"
            aria-label={item.name}
            aria-selected={selectedIndex === index}
            onpointerenter={() => (selectedIndex = index)}
            onpointerdown={(event) => event.preventDefault()}
            onclick={() => selectItem(index)}
          >
            <span class="slash-skill-name type-code">{item.name}</span>
          </Button>
        </Tooltip>
      {/each}
    </div>
  {/if}
</div>

<style>
  .slash-skill-options {
    max-height: 300px;
    overflow-y: auto;
    padding: 4px;
  }

  :global(.slash-skill-option:hover),
  :global(.slash-skill-option.active) {
    background: hsl(var(--primary) / 0.12);
  }

  :global(.slash-skill-option:focus-visible) {
    outline: 2px solid hsl(var(--primary));
    outline-offset: -2px;
  }

  .slash-skill-name {
    flex-shrink: 0;
    font-weight: 600;
  }

  .slash-skill-state {
    padding: 12px;
    color: hsl(var(--muted-foreground));
    font-size: 12px;
    text-align: center;
  }
</style>
