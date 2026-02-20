<script lang="ts">
  import Fa from 'svelte-fa';
  import { faPlus, faMinus } from '@fortawesome/free-solid-svg-icons';
  import AnimatedNumber from '$lib/components/ui/AnimatedNumber.svelte';

  interface Props {
    additions?: number;
    deletions?: number;
    showZero?: boolean;
    size?: 'xxs' | 'xs' | 'sm' | 'md';
    showIcons?: boolean;
    animated?: boolean;
    class?: string;
  }

  let {
    additions = 0,
    deletions = 0,
    showZero = false,
    size = 'xs',
    showIcons = false,
    animated = false,
    class: className = '',
  }: Props = $props();

  // Compute display values
  let hasAdditions = $derived(additions > 0);
  let hasDeletions = $derived(deletions > 0);
  let shouldShow = $derived(hasAdditions || hasDeletions || showZero);

  // Size classes
  const sizeClasses = {
    xxs: 'text-[10px]',
    xs: 'text-[10px]',
    sm: 'text-sm',
    md: 'text-base',
  };

  const iconSizes = {
    xxs: 8,
    xs: 10,
    sm: 12,
    md: 14,
  };

  // Use $derived to react to prop changes
  const textClass = $derived(sizeClasses[size]);
  const iconSize = $derived(iconSizes[size]);
</script>

{#if shouldShow}
  <div class="flex items-center gap-1 {className}">
    {#if hasAdditions || showZero}
      <span
        class="flex items-center whitespace-nowrap gap-0.5 font-mono {textClass} {hasAdditions
          ? 'text-emerald-600 dark:text-emerald-500'
          : 'text-emerald-600/30 dark:text-emerald-500/30'}"
      >
        {#if showIcons}
          <Fa icon={faPlus} size={iconSize === 10 ? 'xs' : iconSize === 12 ? 'xs' : 'sm'} />
        {/if}
        <span>+{#if animated}<AnimatedNumber value={additions} />{:else}{additions.toLocaleString()}{/if}</span>
      </span>
    {/if}

    {#if hasDeletions || showZero}
      <span
        class="flex items-center whitespace-nowrap gap-0.5 font-mono {textClass} {hasDeletions
          ? 'text-red-600 dark:text-red-500'
          : 'text-red-600/30 dark:text-red-500/30'}"
      >
        {#if showIcons}
          <Fa icon={faMinus} size={iconSize === 10 ? 'xs' : iconSize === 12 ? 'xs' : 'sm'} />
        {/if}
        <span>-{#if animated}<AnimatedNumber value={deletions} />{:else}{deletions.toLocaleString()}{/if}</span>
      </span>
    {/if}
  </div>
{/if}
