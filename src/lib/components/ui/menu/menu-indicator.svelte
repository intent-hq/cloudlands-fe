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
    state: 'checked' | 'mixed' | 'submenu' | 'empty';
    'data-slot'?: string;
  } = $props();
</script>

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
