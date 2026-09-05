<script lang="ts">
  import { cn } from '$lib/utils.js';
  import { crispOut } from '$lib/motion';
  import { badgeVariants, type BadgeProps } from './badge.variants';

  let {
    ref = $bindable(null),
    href,
    class: className,
    variant = 'default',
    dot = false,
    leadingIcon,
    removable = false,
    removeLabel,
    onRemove,
    children,
    ...restProps
  }: BadgeProps = $props();

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
    class={cn(badgeVariants({ variant }), className)}
    out:crispOut={{ tier: 'fast' }}
    onoutroend={finishRemove}
    {...restProps}
  >
    {#if dot}
      <span data-slot="badge-dot" class="size-1.5 shrink-0 rounded-full bg-current"></span>
    {/if}
    {#if leadingIcon}
      <span data-slot="badge-icon" class="inline-flex shrink-0">{@render leadingIcon()}</span>
    {/if}
    {@render children?.()}
    {#if removable}
      <button
        type="button"
        data-slot="badge-remove"
        aria-label={removeLabel}
        class="-mr-1 inline-flex size-4 items-center justify-center rounded-full bg-transparent text-current transition-colors duration-spring-fast ease-spring-fast hover:bg-hover active:bg-active motion-reduce:transition-none"
        onclick={beginRemove}
      >
        <span aria-hidden="true">×</span>
      </button>
    {/if}
  </svelte:element>
{/if}
