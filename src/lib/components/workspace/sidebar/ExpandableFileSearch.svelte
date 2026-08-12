<script lang="ts">
  import { faSearch, faTimes } from '@fortawesome/free-solid-svg-icons';
  import { tick } from 'svelte';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    query?: string;
    onKeydown?: (event: KeyboardEvent) => void;
  }

  let { query = $bindable(''), onKeydown }: Props = $props();
  let expanded = $state(Boolean(query));
  let inputRef: Input | null = $state(null);

  $effect(() => {
    if (query) expanded = true;
  });

  async function expand() {
    expanded = true;
    await tick();
    inputRef?.focus();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      query = '';
      expanded = false;
      inputRef?.blur();
      return;
    }
    onKeydown?.(event);
  }
</script>

<div class="flex min-w-0 flex-1 items-center" data-file-search-control>
  {#if expanded}
    <div class="relative w-full" data-file-search-expanded>
      <Fa icon={faSearch} class="absolute left-2.5 top-1/2 -translate-y-1/2 size-2.5 text-ghost" />
      <Input
        bind:this={inputRef}
        bind:value={query}
        type="text"
        placeholder={m.workspace_multiSelectSidebar_searchFiles_placeholder()}
        class="h-7 pl-7 pr-6 text-xs bg-transparent! border-0 placeholder:text-muted-foreground/50!"
        noFocusStyle
        onblur={() => {
          if (!query) expanded = false;
        }}
        onkeydown={handleKeydown}
      />
      {#if query}
        <Button
          variant="plain"
          size="icon-xs"
          class="absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onclick={() => {
            query = '';
            inputRef?.focus();
          }}
          aria-label={m.onboarding_localRepoTab_clearSearch_ariaLabel()}
        >
          <Fa icon={faTimes} class="size-2.5" />
        </Button>
      {/if}
    </div>
  {:else}
    <Button
      variant="ghost"
      size="icon-xs"
      class="ml-0.5 shrink-0 text-subtle"
      tooltip={m.workspace_multiSelectSidebar_searchFiles_placeholder()}
      onclick={expand}
      data-file-search-toggle
    >
      <Fa icon={faSearch} class="size-3" />
    </Button>
  {/if}
</div>
