<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils';

  interface Props extends WithElementRef<Omit<HTMLInputAttributes, 'type' | 'value' | 'oninput'>> {
    value?: number;
    onValueChange?: (value: number) => void;
    oninput?: HTMLInputAttributes['oninput'];
  }

  let {
    ref = $bindable(null),
    value = $bindable(0),
    min = 0,
    max = 100,
    step = 1,
    disabled = false,
    onValueChange,
    oninput,
    class: className,
    'data-slot': dataSlot = 'slider',
    ...restProps
  }: Props = $props();

  function handleInput(event: Event & { currentTarget: EventTarget & HTMLInputElement }) {
    value = event.currentTarget.valueAsNumber;
    onValueChange?.(value);
    oninput?.(event);
  }
</script>

<input
  bind:this={ref}
  bind:value
  type="range"
  {min}
  {max}
  {step}
  {disabled}
  data-slot={dataSlot}
  class={cn(
    'operate-slider h-(--control-height-medium) w-full min-w-24 cursor-pointer appearance-none rounded-(--radius-medium) bg-transparent accent-primary outline-none',
    'focus-visible:ring-2 focus-visible:ring-ring/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
    'aria-invalid:accent-danger aria-invalid:ring-1 aria-invalid:ring-danger/25',
    'transition-[opacity,box-shadow] duration-(--motion-fast) motion-reduce:transition-none',
    className,
  )}
  oninput={handleInput}
  {...restProps}
/>

<style>
  .operate-slider::-webkit-slider-runnable-track {
    height: 1px;
    border: 0;
    border-radius: var(--radius-full);
    background: hsl(var(--border));
  }

  .operate-slider::-webkit-slider-thumb {
    width: 3px;
    height: 14px;
    margin-top: -6.5px;
    appearance: none;
    border: 0;
    border-radius: var(--radius-full);
    background: hsl(var(--primary));
    box-shadow: none;
  }

  .operate-slider::-moz-range-track {
    height: 1px;
    border: 0;
    border-radius: var(--radius-full);
    background: hsl(var(--border));
  }

  .operate-slider::-moz-range-progress {
    height: 1px;
    background: transparent;
  }

  .operate-slider::-moz-range-thumb {
    width: 3px;
    height: 14px;
    border: 0;
    border-radius: var(--radius-full);
    background: hsl(var(--primary));
    box-shadow: none;
  }

  .operate-slider[aria-invalid='true']::-webkit-slider-thumb,
  .operate-slider[aria-invalid='true']::-moz-range-thumb {
    background: hsl(var(--danger));
  }

  .operate-slider[aria-invalid='true']::-webkit-slider-runnable-track,
  .operate-slider[aria-invalid='true']::-moz-range-track {
    border-color: hsl(var(--danger));
  }
</style>
