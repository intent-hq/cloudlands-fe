<script lang="ts">
  import { cn } from '$lib/utils';

  interface Props {
    children?: any;
    class?: string;
    variant?: 'default' | 'outline';
    size?: 'xs' | 'sm' | 'md';
  }

  let { children, class: className = '', variant = 'default', size = 'sm' }: Props = $props();

  const sizeClasses = {
    xs: 'px-1.5 py-0.5 text-ui-sm min-w-[16px] tracking-wider',
    sm: 'px-1.5 py-0.5 text-xs min-w-[20px] tracking-wide',
    md: 'px-2 py-1 text-sm min-w-[24px] tracking-wide',
  };

  const variantClasses = {
    default: 'bg-muted text-subtle',
    outline: 'border border-border text-subtle',
  };
</script>

<kbd
  class={cn(
    'inline-flex items-center justify-center rounded font-mono font-semibold leading-0',
    sizeClasses[size],
    variantClasses[variant],
    className,
  )}
>
  {#if children}
    {@render children()}
  {/if}
</kbd>
