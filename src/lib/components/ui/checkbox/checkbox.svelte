<script lang="ts">
  import { cn } from '$lib/utils';
  import { Checkbox as CheckboxPrimitive } from 'bits-ui';

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
    "checkbox-root border-border bg-card relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-(--radius-small) border-[1.5px] shadow-(--elevation-raised) transition-[border-color,background-color,box-shadow,opacity] duration-spring-fast ease-spring-fast after:absolute after:-inset-1.5 after:content-[''] motion-reduce:transition-none",
    'hover:border-input hover:bg-hover active:bg-active',
    disabled && 'cursor-not-allowed bg-muted/40 opacity-60 hover:border-border',
    readonly && 'cursor-default',
    invalid && 'border-danger ring-1 ring-danger/25',
    'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:hover:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:hover:bg-primary',
    sizeClasses[size],
    className,
  )}
>
  <svg class="checkbox-mark size-[75%]" viewBox="0 0 12 12" aria-hidden="true">
    {#if indeterminate}
      <path class="checkbox-line" d="M2.5 6h7" />
    {:else}
      <path class:drawn={checked} d="m2.25 6.25 2.25 2.2 5.25-5" />
    {/if}
  </svg>
</CheckboxPrimitive.Root>

<style>
  .checkbox-mark path {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
    stroke-dasharray: 12;
    stroke-dashoffset: 12;
    transition:
      stroke-dashoffset var(--spring-fast) var(--spring-fast-ease),
      stroke-width var(--spring-fast) var(--spring-fast-ease);
  }

  .checkbox-mark path.drawn,
  .checkbox-mark path.checkbox-line {
    stroke-dashoffset: 0;
  }

  :global(.checkbox-root:hover) .checkbox-mark path {
    stroke-width: 2;
  }

  @media (prefers-reduced-motion: reduce) {
    .checkbox-mark path {
      transition: none;
    }
  }
</style>
