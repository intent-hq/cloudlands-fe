<script lang="ts">
  import { cn } from '$lib/utils';
  import { Switch as SwitchPrimitive } from 'bits-ui';
  import { onMount, untrack } from 'svelte';
  import { createSwitchThumbSpring, retargetSwitchThumb } from './switch-motion.svelte';

  interface Props {
    id?: string;
    checked?: boolean;
    disabled?: boolean;
    required?: boolean;
    invalid?: boolean;
    class?: string;
    onCheckedChange?: (checked: boolean) => void;
    size?: 'default' | 'compact' | 'xs' | 'sm' | 'md' | 'lg';
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

  const sizes = {
    xs: {
      width: 24,
      height: 14,
      padding: 2,
      thumb: 10,
    },
    sm: {
      width: 28,
      height: 16,
      padding: 2,
      thumb: 12,
    },
    compact: {
      width: 28,
      height: 16,
      padding: 2,
      thumb: 12,
    },
    md: {
      width: 34,
      height: 20,
      padding: 2,
      thumb: 16,
    },
    default: {
      width: 34,
      height: 20,
      padding: 2,
      thumb: 16,
    },
    lg: {
      width: 38,
      height: 22,
      padding: 2,
      thumb: 18,
    },
  };
  let width = $derived(sizes[size].width);
  let height = $derived(sizes[size].height);
  let padding = $derived(sizes[size].padding);
  let thumbWidth = $derived(sizes[size].thumb);
  let thumbHeight = $derived(thumbWidth);
  let reducedMotion = $state(false);
  const thumbPosition = createSwitchThumbSpring(untrack(() => padding));
  const targetPosition = $derived(checked ? width - thumbWidth - padding : padding);

  $effect(() => {
    retargetSwitchThumb(thumbPosition, targetPosition, reducedMotion);
  });

  onMount(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => (reducedMotion = media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });
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
    "border-border peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full border bg-muted shadow-(--elevation-raised) transition-[background-color,box-shadow,opacity] duration-spring-fast ease-spring-fast after:absolute after:-inset-y-2 after:-inset-x-1 after:content-[''] motion-reduce:transition-none",
    'hover:bg-hover active:bg-active',
    'disabled:cursor-not-allowed disabled:opacity-60',
    'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:hover:bg-primary data-[state=checked]:active:bg-primary',
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
      'bg-card pointer-events-none absolute top-1/2 left-0 block rounded-full shadow-(--elevation-raised) ring-0 data-[state=checked]:bg-primary-foreground',
    )}
    style={`
      width: ${thumbWidth}px;
      height: ${thumbHeight}px;
      transform: translateX(${thumbPosition.current}px) translateY(-50%);
    `}
  />
</SwitchPrimitive.Root>
