<script lang="ts">
  import { cn } from '$lib/utils';

  let {
    value = 0,
    max = 1,
    centered = false,
    size = 'compact',
    testId = 'effort-gauge',
    class: className = '',
  } = $props<{
    value?: number;
    max?: number;
    centered?: boolean;
    size?: 'compact' | 'prominent';
    testId?: string;
    class?: string;
  }>();

  const progress = $derived(centered ? 0.5 : max > 0 ? Math.min(1, Math.max(0, value / max)) : 0.5);
  const needleAngle = $derived(-65 + progress * 130);
  const width = $derived(size === 'prominent' ? 28 : 16);
  const height = $derived(size === 'prominent' ? 20 : 16);
  const strokeWidth = $derived(size === 'prominent' ? 1.5 : 2);
</script>

<svg
  viewBox="0 0 20 14"
  {width}
  {height}
  class={cn('block shrink-0 overflow-visible', className)}
  aria-hidden="true"
  data-testid={testId}
  data-gauge-value={value}
  data-gauge-centered={centered}
  data-gauge-size={size}
>
  <path
    d="M3 11a7 7 0 0 1 14 0"
    fill="none"
    stroke="currentColor"
    stroke-width={strokeWidth}
    stroke-linecap="round"
    opacity="0.6"
  />
  <line
    class="transition-transform duration-(--motion-slow) ease-(--ease-emphasized-out) motion-reduce:transition-none"
    data-testid={`${testId}-needle`}
    x1="10"
    y1="11"
    x2="10"
    y2="4.5"
    stroke="currentColor"
    stroke-width={strokeWidth}
    stroke-linecap="round"
    style:transform={`rotate(${needleAngle}deg)`}
    style:transform-origin="10px 11px"
  />
  <circle cx="10" cy="11" r="1.25" fill="currentColor" />
</svg>
