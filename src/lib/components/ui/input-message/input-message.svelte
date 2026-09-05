<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { crispOut, springIn } from '$lib/motion';
  import { cn } from '$lib/utils.js';

  let {
    tone = 'helper',
    children,
    class: className,
    ...restProps
  }: HTMLAttributes<HTMLParagraphElement> & {
    tone?: 'helper' | 'error';
    children: Snippet;
  } = $props();
</script>

<p
  data-slot="input-message"
  data-tone={tone}
  role={tone === 'error' ? 'alert' : undefined}
  aria-live={tone === 'helper' ? 'polite' : undefined}
  class={cn(
    'type-body mt-1.5 pl-0.5 motion-reduce:transition-none',
    tone === 'error' ? 'text-error-foreground' : 'text-muted-foreground',
    className,
  )}
  in:springIn={{ tier: 'fast', y: -2, scale: 1 }}
  out:crispOut={{ tier: 'fast' }}
  {...restProps}
>
  {@render children()}
</p>
