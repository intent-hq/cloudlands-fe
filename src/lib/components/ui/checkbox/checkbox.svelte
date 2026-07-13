<script lang="ts">
  import { cn } from '$lib/utils';
  import Fa from 'svelte-fa';
  import {
  faCheck,
  faMinus,
} from '@fortawesome/free-solid-svg-icons';
  import { fly } from 'svelte/transition';

  interface Props {
    id?: string;
    checked?: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    class?: string;
    onCheckedChange?: (checked: boolean) => void;
    name?: string;
    value?: string;
    ariaLabel?: string;
    ariaLabelledby?: string;
    ariaDescribedby?: string;
    size?: 'sm' | 'md' | 'lg';
  }

  let {
    id = '',
    checked = $bindable(false),
    indeterminate = false,
    disabled = false,
    class: className = '',
    onCheckedChange,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    name,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    value = 'on',
    ariaLabel,
    ariaLabelledby,
    ariaDescribedby,
    size = 'md',
  }: Props = $props();

  function handleClick(e: MouseEvent) {
    if (!disabled) {
      e.stopPropagation();
      checked = !checked;
      onCheckedChange?.(checked);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (disabled) return;

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      checked = !checked;
      onCheckedChange?.(checked);
    }
  }

  const sizeClasses = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  const iconSizes = {
    sm: '0.55rem',
    md: '0.6rem',
    lg: '0.75rem',
  };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  {id}
  role="checkbox"
  tabindex={disabled ? -1 : 0}
  aria-checked={indeterminate ? 'mixed' : checked}
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledby}
  aria-describedby={ariaDescribedby}
  data-state={indeterminate ? 'indeterminate' : checked ? 'checked' : 'unchecked'}
  data-disabled={disabled ? '' : undefined}
  onclick={handleClick}
  onkeydown={handleKeyDown}
  class={cn(
    'inline-flex items-center justify-center shrink-0 rounded-xs transition-all duration-150',
    'border border-muted-foreground/30 cursor-pointer',
    'bg-background',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    disabled && 'cursor-not-allowed opacity-50',
    'data-[state=checked]:bg-foreground data-[state=checked]:border-foreground data-[state=indeterminate]:bg-muted',
    sizeClasses[size],
    className,
  )}
>
  {#if indeterminate}
  <div transition:fly={{y: 9, duration: 150}}>
    <Fa icon={faMinus} size={iconSizes[size]} class="text-background mt-[-0.1em]" />
    </div>
  {:else if checked}
  <div transition:fly={{y: 9, duration: 150}}>
    <Fa icon={faCheck} size={iconSizes[size]} class="text-background mt-[-0.1em]" />
    </div>
  {/if}
</div>
