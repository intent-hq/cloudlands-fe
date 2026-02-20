<script lang="ts">
  import Fa from 'svelte-fa';
  import { faXmark, faHashtag } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    tags?: string[];
    placeholder?: string;
    suggestions?: string[];
    onAdd?: (tag: string) => void;
    onRemove?: (tag: string) => void;
  }

  let {
    tags = $bindable([]),
    placeholder = 'Add tags...',
    suggestions = [],
    onAdd,
    onRemove,
  }: Props = $props();

  let inputValue = $state('');
  let showSuggestions = $state(false);
  let selectedIndex = $state(-1);
  let inputElement = $state<HTMLInputElement | null>(null);

  const filteredSuggestions = $derived(
    suggestions
      .filter((s) => s.toLowerCase().includes(inputValue.toLowerCase()) && !tags.includes(s))
      .slice(0, 5),
  );

  function addTag(tag: string) {
    if (tag && !tags.includes(tag)) {
      tags = [...tags, tag];
      onAdd?.(tag);
      inputValue = '';
      selectedIndex = -1;
    }
  }

  function removeTag(tag: string) {
    tags = tags.filter((t) => t !== tag);
    onRemove?.(tag);
  }

  function handleKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && filteredSuggestions[selectedIndex]) {
          addTag(filteredSuggestions[selectedIndex]);
        } else if (inputValue.trim()) {
          addTag(inputValue.trim());
        }
        break;
      case 'Backspace':
        if (!inputValue && tags.length > 0) {
          removeTag(tags[tags.length - 1]);
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filteredSuggestions.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        break;
      case 'Escape':
        showSuggestions = false;
        selectedIndex = -1;
        break;
    }
  }

  function handleInput() {
    showSuggestions = inputValue.length > 0 && filteredSuggestions.length > 0;
    selectedIndex = -1;
  }

  function handleFocus() {
    if (inputValue && filteredSuggestions.length > 0) {
      showSuggestions = true;
    }
  }

  function handleBlur() {
    // Delay to allow click on suggestion
    setTimeout(() => {
      showSuggestions = false;
    }, 200);
  }
</script>

<div class="relative">
  <div class="flex items-center gap-2 flex-wrap p-2 bg-muted rounded-md min-h-[40px]">
    {#each tags as tag, tagIndex (`tag-${tagIndex}-${tag}`)}
      <span
        class="px-2 py-1 bg-primary/10 text-primary rounded-full text-sm flex items-center gap-1 animate-in fade-in duration-200"
      >
        <Fa icon={faHashtag} size="xs" />
        {tag}
        <button
          class="ml-1 hover:text-red-500 transition-colors"
          onclick={() => removeTag(tag)}
          aria-label="Remove tag"
        >
          <Fa icon={faXmark} size="xs" />
        </button>
      </span>
    {/each}

    <div class="flex-1 min-w-[100px] relative">
      <input
        bind:this={inputElement}
        bind:value={inputValue}
        onkeydown={handleKeyDown}
        oninput={handleInput}
        onfocus={handleFocus}
        onblur={handleBlur}
        type="text"
        {placeholder}
        class="w-full bg-transparent focus:outline-none text-sm"
      />
    </div>
  </div>

  {#if showSuggestions}
    <div
      class="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg z-10"
    >
      {#each filteredSuggestions as suggestion, i (`suggestion-${i}-${suggestion}`)}
        <button
          class="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 transition-colors
						{selectedIndex === i ? 'bg-muted' : ''}"
          onclick={() => addTag(suggestion)}
        >
          <Fa icon={faHashtag} size="xs" />
          {suggestion}
        </button>
      {/each}
    </div>
  {/if}
</div>
