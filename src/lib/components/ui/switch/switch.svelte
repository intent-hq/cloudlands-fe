<script lang="ts">
  import { cn } from '$lib/utils';

  interface Props {
    id?: string;
    checked?: boolean;
    disabled?: boolean;
    class?: string;
    onCheckedChange?: (checked: boolean) => void;
    size?: 'sm' | 'md' | 'lg';
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

  function handleClick() {
    if (!disabled) {
      checked = !checked;
      onCheckedChange?.(checked);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (disabled) return;

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      checked = !checked;
      onCheckedChange?.(checked);
    }
  }
</script>

<button
  {id}
  {name}
  {disabled}
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledby}
  aria-describedby={ariaDescribedby}
  data-state={checked ? 'checked' : 'unchecked'}
  data-disabled={disabled ? '' : undefined}
  {value}
  onclick={handleClick}
  onkeydown={handleKeyDown}
  class={cn(
    'relative peer inline-flex shrink-0 cursor-pointer items-center rounded-full shadow-sm transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'data-[state=unchecked]:bg-input data-[state=checked]:bg-primary',

    className,
  )}
  style={`
    width: ${width}px;
    height: ${height}px;
  `}
>
  <span
    class={cn(
      'pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform absolute top-1/2 left-0',
    )}
    style={`
      width: ${thumbWidth}px;
      height: ${thumbHeight}px;
      transform: translateX(${checked ? width - thumbWidth - padding : padding}px) translateY(-50%);
    `}
    data-state={checked ? 'checked' : 'unchecked'}
  ></span>
</button>
