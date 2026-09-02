<script lang="ts">
  import { tick } from 'svelte';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { m } from '$shared/paraglide/messages.js';
  import SidebarActionIcon from './SidebarActionIcon.svelte';
  import SidebarHeaderAction from './SidebarHeaderAction.svelte';

  interface Props {
    query?: string;
    placeholder: string;
    scope: 'agents' | 'context' | 'files';
    placement?: 'header' | 'toolbar';
    onKeydown?: (event: KeyboardEvent) => void;
  }

  let {
    query = $bindable(''),
    placeholder,
    scope,
    placement = 'header',
    onKeydown,
  }: Props = $props();
  let expanded = $state(Boolean(query));
  let inputRef: Input | null = $state(null);
  let triggerRef = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (query) expanded = true;
  });

  async function expand() {
    expanded = true;
    await tick();
    inputRef?.focus();
  }

  async function close(restoreFocus: boolean) {
    query = '';
    expanded = false;
    await tick();
    if (restoreFocus) triggerRef?.focus();
  }

  $effect(() => {
    if (!expanded) return;
    return pushEscapeLayer(() => {
      void close(true);
    });
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') return;
    onKeydown?.(event);
  }
</script>

<div
  class:sidebar-search--header={placement === 'header'}
  class="flex min-w-0 items-center {placement === 'toolbar'
    ? 'flex-1'
    : expanded
      ? 'flex-1'
      : 'shrink-0'}"
  data-sidebar-search={scope}
>
  {#if expanded}
    <div class="relative w-full min-w-0" data-sidebar-search-expanded={scope}>
      <SidebarActionIcon icon="search" />
      <Input
        bind:this={inputRef}
        bind:value={query}
        type="search"
        aria-label={placeholder}
        {placeholder}
        class="h-7 min-w-0 bg-transparent! py-0 pl-7 pr-7 text-xs shadow-none! placeholder:text-muted-foreground/60!"
        noFocusStyle
        onblur={() => {
          if (!query) void close(false);
        }}
        onkeydown={handleKeydown}
        data-sidebar-search-input={scope}
      />
      <Button
        variant="ghost"
        size="icon-xs"
        class="absolute right-0 top-0 flex items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:bg-muted motion-reduce:transition-none"
        onclick={() => {
          query = '';
          inputRef?.focus();
        }}
        aria-label={m.workspace_sidebarSearch_clear_ariaLabel()}
        data-sidebar-search-clear={scope}
      >
        <SidebarActionIcon icon="close" />
      </Button>
    </div>
  {:else}
    <SidebarHeaderAction bind:ref={triggerRef} icon="search" label={placeholder} onclick={expand} />
  {/if}
</div>

<style>
  :global(.sidebar-search--header:has([data-sidebar-search-expanded])) {
    width: clamp(5.5rem, 36cqi, 10rem);
  }

  [data-sidebar-search-expanded] > :global(svg) {
    position: absolute;
    left: 0.5rem;
    top: 50%;
    z-index: 1;
    transform: translateY(-50%);
    color: hsl(var(--muted-foreground));
    pointer-events: none;
  }

  :global([data-sidebar-search-input]::-webkit-search-cancel-button) {
    display: none;
  }
</style>
