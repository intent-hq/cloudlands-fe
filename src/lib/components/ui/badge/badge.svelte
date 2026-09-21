<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils.js';
  import { crispOut } from '$lib/motion';
  import { useSize } from '$lib/components/ui/size-context';
  import { badgeVariants, badgeColors, resolveBadge, type BadgeProps } from './badge.variants';

  let {
    ref = $bindable(null),
    href,
    class: className,
    variant = 'solid',
    color,
    size,
    style,
    dot = false,
    leadingIcon,
    removable = false,
    removeLabel,
    onRemove,
    children,
    ...restProps
  }: BadgeProps = $props();

  const contextSize = useSize();
  const resolved = $derived(resolveBadge(variant, color));
  const resolvedSize = $derived(
    size === 'sm' ? 'compact' : size === 'md' || size === 'lg' ? 'default' : (size ?? contextSize),
  );
  const colorValue = $derived(badgeColors[resolved.color]);
  const colorStyle = $derived(
    resolved.variant === 'solid'
      ? `background-color: ${resolved.color === 'gray' ? 'hsl(var(--accent))' : `color-mix(in srgb, ${colorValue} 15%, hsl(var(--background)))`};`
      : '',
  );
  let visible = $state(true);
  let removeEvent: MouseEvent | null = null;

  function beginRemove(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    removeEvent = event;
    visible = false;
  }

  function finishRemove() {
    if (!removeEvent) return;
    onRemove?.(removeEvent);
    removeEvent = null;
  }
</script>

{#if visible}
  <svelte:element
    this={href ? 'a' : 'span'}
    bind:this={ref}
    data-slot="badge"
    data-removable={removable || undefined}
    {href}
    class={cn(badgeVariants({ variant: resolved.variant, size: resolvedSize }), className)}
    style={`${colorStyle}${style ?? ''}`}
    data-variant={resolved.variant}
    data-color={resolved.color}
    data-size={resolvedSize}
    out:crispOut={{ tier: 'fast' }}
    onoutroend={finishRemove}
    {...restProps}
  >
    {#if dot || resolved.variant === 'dot'}
      <span
        data-slot="badge-dot"
        class={cn('shrink-0 rounded-full', resolvedSize === 'compact' ? 'size-1.5' : 'size-[7px]')}
        style:background-color={resolved.color === 'gray'
          ? 'hsl(var(--muted-foreground))'
          : colorValue}
      ></span>
    {/if}
    {#if leadingIcon}
      <span data-slot="badge-icon" class="inline-flex shrink-0">{@render leadingIcon()}</span>
    {/if}
    <span class="[text-box:trim-both_cap_alphabetic]">{@render children?.()}</span>
    {#if removable}
      <Button
        variant="ghost"
        size="icon-compact"
        data-slot="badge-remove"
        aria-label={removeLabel}
        class="-mr-1 inline-flex size-4 items-center justify-center rounded-full bg-transparent text-current transition-colors duration-spring-fast ease-spring-fast hover:bg-hover active:bg-active motion-reduce:transition-none"
        onclick={beginRemove}
      >
        <span aria-hidden="true">×</span>
      </Button>
    {/if}
  </svelte:element>
{/if}
