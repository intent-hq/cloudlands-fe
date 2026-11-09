<script lang="ts">
  import { cn } from '$lib/utils.js';

  let { checked }: { checked: boolean } = $props();
</script>

<span data-slot="menu-switch" class="ml-auto flex h-lh shrink-0 items-center" aria-hidden="true">
  <span
    data-state={checked ? 'checked' : 'unchecked'}
    class="relative block h-3.5 w-6 rounded-full bg-muted-foreground/25 transition-colors duration-spring-fast ease-spring-fast data-[state=checked]:bg-foreground/80 motion-reduce:transition-none"
  >
    <span
      class={cn(
        'absolute top-0.5 left-0.5 size-2.5 rounded-full bg-popover transition-transform duration-spring-fast ease-spring-fast motion-reduce:transition-none',
        checked && 'translate-x-2.5',
      )}
    ></span>
  </span>
</span>
