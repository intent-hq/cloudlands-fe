<script lang="ts">
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faCheck, faMinus, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { OPTION_LIST_END_SLOT_CLASS } from '$lib/styles/option-list-row';
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    state,
    class: className,
    'data-slot': slot,
    ...restProps
  }: HTMLAttributes<HTMLSpanElement> & {
    state: 'checked' | 'mixed' | 'submenu' | 'empty' | 'on' | 'off';
    'data-slot'?: string;
  } = $props();
</script>

{#if state === 'on' || state === 'off'}
  <span
    {...restProps}
    data-slot={slot ?? 'menu-switch'}
    class={cn('ml-auto flex h-lh shrink-0 items-center', className)}
    aria-hidden="true"
  >
    <span
      data-state={state === 'on' ? 'checked' : 'unchecked'}
      class="relative block h-3.5 w-6 rounded-full bg-muted-foreground/25 transition-colors duration-spring-fast ease-spring-fast data-[state=checked]:bg-foreground/80 motion-reduce:transition-none"
    >
      <span
        class={cn(
          'absolute top-0.5 left-0.5 size-2.5 rounded-full bg-popover transition-transform duration-spring-fast ease-spring-fast motion-reduce:transition-none',
          state === 'on' && 'translate-x-2.5',
        )}
      ></span>
    </span>
  </span>
{:else}
  <span
    {...restProps}
    data-slot={slot ?? (state === 'submenu' ? 'menu-sub-chevron' : 'menu-item-indicator')}
    class={cn(
      OPTION_LIST_END_SLOT_CLASS,
      state === 'submenu' ? 'text-muted-foreground' : 'text-primary-ink',
      className,
    )}
    aria-hidden="true"
  >
    {#if state !== 'empty'}
      <Fa
        icon={state === 'mixed' ? faMinus : state === 'submenu' ? faChevronRight : faCheck}
        size={state === 'submenu'
          ? 'calc(var(--space-2) + var(--space-1) / 2)'
          : 'var(--menu-icon-size)'}
        class={state === 'submenu' ? 'size-2.5 rtl:rotate-180' : 'size-(--menu-icon-size)'}
      />
    {/if}
  </span>
{/if}
