<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { setContext } from 'svelte';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { SUBMENU_CONTEXT, type SubmenuContext } from './submenu-context';

  let { open = $bindable(false), onOpenChange, ...restProps }: MenuPrimitive.SubProps = $props();
  const context: SubmenuContext = { trigger: null };
  setContext(SUBMENU_CONTEXT, context);

  $effect(() => {
    if (!open) return;
    return pushEscapeLayer(() => {
      open = false;
      onOpenChange?.(false);
      context.trigger?.focus({ preventScroll: true });
    });
  });
</script>

<MenuPrimitive.Sub bind:open {onOpenChange} {...restProps} />
