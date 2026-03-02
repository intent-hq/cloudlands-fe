<script lang="ts">
  import Fa from 'svelte-fa';
  import { faSearch, faXmark } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    value?: string;
    placeholder?: string;
  }

  let { value = $bindable(''), placeholder = 'Search...' }: Props = $props();

  let inputElement: HTMLInputElement | undefined = $state(undefined);

  function handleClear() {
    value = '';
    inputElement?.focus();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClear();
    }
  }
</script>

<div class="search-bar relative">
  <Fa
    icon={faSearch}
    class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle pointer-events-none"
  />
  <input
    bind:this={inputElement}
    bind:value
    onkeydown={handleKeyDown}
    type="text"
    {placeholder}
    class="w-full pl-9 pr-9 py-2 bg-muted rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
  />
  {#if value}
    <button
      class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-background"
      onclick={handleClear}
      aria-label="Clear search"
    >
      <Fa icon={faXmark} class="w-3 h-3" />
    </button>
  {/if}
</div>
