<script lang="ts">
  interface Props {
    variant?: string;
    size?: string;
    onclick?: (event: MouseEvent) => void;
    class?: string;
    [key: string]: any;
  }

  let { variant: _variant, size: _size, onclick, class: className, ...restProps }: Props = $props();
</script>

<button
  type="button"
  {onclick}
  class={className}
  data-variant={_variant}
  data-size={_size}
  {...restProps}
>
  <slot />
</button>
