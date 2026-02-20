<script lang="ts">
  import { setContext, onMount, onDestroy } from 'svelte';
  import type { Snippet } from 'svelte';

  let {
    value = $bindable(''),
    open = $bindable(false),
    children,
  }: { value: string; open?: boolean; children?: Snippet } = $props();

  // Use the bound prop directly instead of internal state
  let selectId = crypto.randomUUID();

  // Store trigger element reference for portal positioning
  let triggerEl: HTMLElement | undefined = $state();

  // Create a reactive context that properly updates
  const context = {
    get value() {
      return value;
    },
    set value(v: string) {
      value = v;
    },
    get isOpen() {
      return open ?? false;
    },
    set isOpen(v: boolean) {
      // Close other selects when opening this one
      if (v && !open) {
        window.dispatchEvent(new CustomEvent('select-open', { detail: selectId }));
      }
      open = v;
    },
    get triggerEl() {
      return triggerEl;
    },
    set triggerEl(el: HTMLElement | undefined) {
      triggerEl = el;
    },
  };

  setContext('select', context);

  // Listen for other selects opening
  function handleOtherSelectOpen(event: CustomEvent) {
    if (event.detail !== selectId && open) {
      open = false;
    }
  }

  onMount(() => {
    window.addEventListener('select-open', handleOtherSelectOpen as EventListener);
  });

  onDestroy(() => {
    window.removeEventListener('select-open', handleOtherSelectOpen as EventListener);
  });
</script>

<div class="relative w-full">
  {@render children?.()}
</div>
