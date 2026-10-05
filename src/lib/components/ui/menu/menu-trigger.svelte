<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils.js';
  import { getContext } from 'svelte';

  let {
    ref = $bindable(null),
    class: className,
    child,
    children,
    ...restProps
  }: MenuPrimitive.TriggerProps = $props();

  const menu = getContext<{ readonly open: boolean }>('canonical-menu');

  const triggerClass = $derived(cn(className));
</script>

<!-- i18n-ignore (snippet parameter type annotation, not UI text) -->
{#snippet buttonChild({ props }: { props: Record<string, unknown> })}
  <Button {...props} class={triggerClass} active={menu.open}>
    {@render children?.()}
  </Button>
{/snippet}

<MenuPrimitive.Trigger
  bind:ref
  data-slot="menu-trigger"
  class={triggerClass}
  child={child ?? buttonChild}
  {...restProps}
/>
