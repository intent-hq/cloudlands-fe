<script lang="ts">
  import { cn } from '$lib/utils';
  import { Switch as SwitchPrimitive } from 'bits-ui';

  interface Props {
    id?: string;
    checked?: boolean;
    disabled?: boolean;
    required?: boolean;
    invalid?: boolean;
    class?: string;
    onCheckedChange?: (checked: boolean) => void;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    name?: string;
    value?: string;
    ariaLabel?: string;
    ariaLabelledby?: string;
    ariaDescribedby?: string;
  }

  let {
    id = '',
    checked = $bindable(false),
    disabled = false,
    required = false,
    invalid = false,
    class: className = '',
    onCheckedChange,
    size = 'md',
    name,
    value = 'on',
    ariaLabel,
    ariaLabelledby,
    ariaDescribedby,
  }: Props = $props();

  const paddingRatio = 0.15;
  const sizes = {
    xs: {
      width: 12,
      height: 6,
    },
    sm: {
      width: 18,
      height: 12,
    },
    md: {
      width: 24,
      height: 14,
    },
    lg: {
      width: 28,
      height: 16,
    },
  };
  let width = $derived(sizes[size].width);
  let height = $derived(sizes[size].height);
  let padding = $derived(height * paddingRatio);
  let thumbWidth = $derived(height * (1 - paddingRatio * 2));
  let thumbHeight = $derived(thumbWidth);
</script>

<SwitchPrimitive.Root
  bind:checked
  {id}
  {name}
  {value}
  {disabled}
  {required}
  {onCheckedChange}
  type="button"
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledby}
  aria-describedby={ariaDescribedby}
  aria-invalid={invalid || undefined}
  class={cn(
    "border-border peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full border shadow-(--elevation-raised) transition-[border-color,background-color,box-shadow,opacity] duration-(--motion-fast) after:absolute after:-inset-y-2 after:-inset-x-1 after:content-[''] motion-reduce:transition-none",
    'hover:border-input focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
    'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border',
    'data-[state=unchecked]:bg-muted data-[state=checked]:border-primary/60 data-[state=checked]:bg-accent',
    invalid && 'border-danger ring-1 ring-danger/25',
    className,
  )}
  style={`
    width: ${width}px;
    height: ${height}px;
  `}
>
  <SwitchPrimitive.Thumb
    class={cn(
      'bg-card pointer-events-none absolute top-1/2 left-0 block rounded-full shadow-(--elevation-raised) ring-0 transition-transform duration-(--motion-standard) motion-reduce:transition-none',
    )}
    style={`
      width: ${thumbWidth}px;
      height: ${thumbHeight}px;
      transform: translateX(${checked ? width - thumbWidth - padding : padding}px) translateY(-50%);
    `}
  />
</SwitchPrimitive.Root>
