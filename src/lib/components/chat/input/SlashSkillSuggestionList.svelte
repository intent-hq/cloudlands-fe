<script lang="ts">
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

<div class="slash-skill-suggestion-list">
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
        <button
          type="button"
          id={`${componentId}-option-${index}`}
          class:active={selectedIndex === index}
          role="option"
          aria-selected={selectedIndex === index}
          onpointerenter={() => (selectedIndex = index)}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => selectItem(index)}
        >
          <span class="slash-skill-name">/{item.name}</span>
          <span class="slash-skill-description">{item.description}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .slash-skill-suggestion-list {
    width: 100%;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--popover));
    color: hsl(var(--foreground));
  }

  .slash-skill-options {
    max-height: 300px;
    overflow-y: auto;
    padding: 4px;
  }

  button {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: 10px;
    border: 0;
    padding: 6px 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  button:hover,
  button.active {
    background: hsl(var(--primary) / 0.12);
  }

  button:focus-visible {
    outline: 2px solid hsl(var(--primary));
    outline-offset: -2px;
  }

  .slash-skill-name {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
  }

  .slash-skill-description {
    min-width: 0;
    overflow: hidden;
    color: hsl(var(--muted-foreground));
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slash-skill-state {
    padding: 12px;
    color: hsl(var(--muted-foreground));
    font-size: 12px;
    text-align: center;
  }
</style>
