<script lang="ts">
  export let variant: string = 'default';
  export let size: string = 'default';
  export let disabled: boolean = false;
  export let title: string | undefined = undefined;
  export let tooltip: string | undefined = undefined;
  export let onclick: (() => void) | undefined = undefined;

  let className: string = '';
  export { className as class };
</script>

<button
  class={className}
  {disabled}
  title={title ?? tooltip}
  {onclick}
  data-variant={variant}
  data-size={size}
  {...$$restProps}
>
  <slot />
</button>
