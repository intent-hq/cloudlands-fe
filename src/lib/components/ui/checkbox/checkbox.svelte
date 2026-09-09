<script lang="ts">
  import { cn } from '$lib/utils';
  import { faCheck, faMinus } from '@fortawesome/free-solid-svg-icons';
  import { Checkbox as CheckboxPrimitive } from 'bits-ui';
  import Fa from 'svelte-fa';

  interface Props {
    id?: string;
    checked?: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    required?: boolean;
    readonly?: boolean;
    invalid?: boolean;
    class?: string;
    onCheckedChange?: (checked: boolean) => void;
    onIndeterminateChange?: (indeterminate: boolean) => void;
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
    indeterminate = $bindable(false),
    disabled = false,
    required = false,
    readonly = false,
    invalid = false,
    class: className = '',
    onCheckedChange,
    onIndeterminateChange,
    name,
    value = 'on',
    ariaLabel,
    ariaLabelledby,
    ariaDescribedby,
    size = 'md',
  }: Props = $props();

  function stopClickPropagation(event: MouseEvent) {
    event.stopPropagation();
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

<CheckboxPrimitive.Root
  bind:checked
  bind:indeterminate
  {id}
  {disabled}
  {required}
  {readonly}
  {name}
  {value}
  {onCheckedChange}
  {onIndeterminateChange}
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledby}
  aria-describedby={ariaDescribedby}
  aria-invalid={invalid || undefined}
  onclick={stopClickPropagation}
  class={cn(
    "border-border bg-card relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-(--radius-small) border shadow-(--elevation-raised) transition-[border-color,background-color,box-shadow,opacity] duration-(--motion-fast) after:absolute after:-inset-1.5 after:content-[''] motion-reduce:transition-none",
    'hover:border-input hover:bg-muted/50 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
    disabled && 'cursor-not-allowed bg-muted/40 opacity-60 hover:border-border',
    readonly && 'cursor-default',
    invalid && 'border-danger ring-1 ring-danger/25',
    'data-[state=checked]:border-primary/60 data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[state=indeterminate]:border-primary/60 data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-foreground',
    sizeClasses[size],
    className,
  )}
>
  {#if indeterminate}
    <div class="flex items-center justify-center" aria-hidden="true">
      <Fa icon={faMinus} size={iconSizes[size]} class="-mt-px text-accent-foreground" />
    </div>
  {:else if checked}
    <div class="flex items-center justify-center" aria-hidden="true">
      <Fa icon={faCheck} size={iconSizes[size]} class="-mt-px text-accent-foreground" />
    </div>
  {/if}
</CheckboxPrimitive.Root>
