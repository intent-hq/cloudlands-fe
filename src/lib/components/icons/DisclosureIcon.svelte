<script lang="ts">
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
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
  aria-hidden="true"
  class={cn(
    'inline-flex size-3 shrink-0 items-center justify-center text-muted-foreground',
    className,
  )}
>
  <Fa
    icon={faChevronDown}
    size={12}
    class="transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {expanded
      ? ''
      : '-rotate-90'}"
  />
</span>
