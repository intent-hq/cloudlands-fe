<script lang="ts">
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
  import { cn } from '$lib/utils';

  let {
    expanded,
    class: className,
    ...rest
  }: {
    expanded: boolean;
    class?: string;
    [attribute: `data-${string}`]: string | boolean | undefined;
  } = $props();
</script>

<span
  {...rest}
  data-disclosure-icon
  aria-hidden="true"
  class={cn(
    'inline-flex size-3 shrink-0 items-center justify-center text-muted-foreground',
    className,
  )}
>
  <!-- Host buttons size descendant SVGs; keep the glyph dimensions explicit. -->
  <CaretDownIcon
    size={10}
    weight="regular"
    mirrored={false}
    style="width: 0.625rem; height: 0.625rem;"
    aria-hidden="true"
    focusable="false"
    data-owns-stroke
    data-disclosure-glyph
    class="transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {expanded
      ? ''
      : '-rotate-90'}"
  />
</span>
