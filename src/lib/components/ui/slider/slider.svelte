<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils';

  interface Props extends WithElementRef<Omit<HTMLInputAttributes, 'type' | 'value' | 'oninput'>> {
    value?: number;
    onValueChange?: (value: number) => void;
    oninput?: HTMLInputAttributes['oninput'];
    formatValue?: (value: number) => string;
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
    formatValue,
    class: className,
    'data-slot': dataSlot = 'slider',
    ...restProps
  }: Props = $props();
  let dragging = $state(false);
  let lastEmittedValue = value;
  const percentage = $derived(
    max === min ? 0 : ((value - Number(min)) / (Number(max) - Number(min))) * 100,
  );

  function syncValue(input: HTMLInputElement) {
    const nextValue = input.valueAsNumber;
    if (Number.isNaN(nextValue)) return;
    if (nextValue !== value) value = nextValue;
    if (nextValue !== lastEmittedValue) {
      lastEmittedValue = nextValue;
      onValueChange?.(nextValue);
    }
  }

  $effect(() => {
    if (!dragging) lastEmittedValue = value;
  });

  function handleInput(event: Event & { currentTarget: EventTarget & HTMLInputElement }) {
    syncValue(event.currentTarget);
    oninput?.(event);
  }

  function handlePointerDown() {
    dragging = true;
  }

  function handlePointerMove(
    event: PointerEvent & { currentTarget: EventTarget & HTMLInputElement },
  ) {
    if (dragging) syncValue(event.currentTarget);
  }

  function handlePointerEnd() {
    dragging = false;
  }
</script>

<span class="relative inline-flex w-full items-center" data-dragging={dragging || undefined}>
  <span
    aria-hidden="true"
    class="pointer-events-none absolute inset-x-2 h-4.5 overflow-hidden rounded-full border border-border"
  >
    <span
      class="bg-selected/50 absolute inset-y-0 left-0 rounded-full transition-[width] duration-spring-fast ease-spring-fast motion-reduce:transition-none"
      style:width={`${Math.min(100, Math.max(0, percentage))}%`}
    ></span>
  </span>
  {#if dragging}
    <output
      class="bg-popover text-popover-foreground pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 rounded-(--radius-small) px-1.5 py-0.5 text-ui-xs shadow-(--elevation-raised)"
      style:left={`${Math.min(100, Math.max(0, percentage))}%`}
      aria-hidden="true">{formatValue?.(value) ?? value}</output
    >
  {/if}
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
      'operate-slider h-(--control-height-medium) w-full min-w-24 cursor-pointer appearance-none rounded-(--radius-medium) bg-transparent accent-primary',
      'disabled:cursor-not-allowed disabled:opacity-60',
      'aria-invalid:accent-danger aria-invalid:ring-1 aria-invalid:ring-danger/25',
      'transition-[opacity,box-shadow] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
      className,
    )}
    oninput={handleInput}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerEnd}
    onpointercancel={handlePointerEnd}
    onblur={handlePointerEnd}
    {...restProps}
  />
</span>

<style>
  .operate-slider::-webkit-slider-runnable-track {
    height: 18px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
  }

  .operate-slider::-webkit-slider-thumb {
    width: 16px;
    height: 16px;
    margin-top: 1px;
    appearance: none;
    border: 0;
    border-radius: var(--radius-full);
    background: hsl(var(--background));
    box-shadow: var(--elevation-raised);
    transform: scale(1);
    transition: transform var(--spring-moderate) var(--spring-moderate-ease);
  }

  .operate-slider::-moz-range-track {
    height: 18px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
  }

  .operate-slider::-moz-range-progress {
    height: 18px;
    background: transparent;
  }

  .operate-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border: 0;
    border-radius: var(--radius-full);
    background: hsl(var(--background));
    box-shadow: var(--elevation-raised);
    transform: scale(1);
    transition: transform var(--spring-moderate) var(--spring-moderate-ease);
  }

  .operate-slider:hover::-webkit-slider-thumb,
  .operate-slider:active::-webkit-slider-thumb,
  .operate-slider:hover::-moz-range-thumb,
  .operate-slider:active::-moz-range-thumb {
    transform: scale(1.125);
  }

  .operate-slider[aria-invalid='true']::-webkit-slider-thumb,
  .operate-slider[aria-invalid='true']::-moz-range-thumb {
    background: hsl(var(--danger));
  }

  .operate-slider[aria-invalid='true']::-webkit-slider-runnable-track,
  .operate-slider[aria-invalid='true']::-moz-range-track {
    border-color: hsl(var(--danger));
  }

  @media (prefers-reduced-motion: reduce) {
    .operate-slider::-webkit-slider-thumb,
    .operate-slider::-moz-range-thumb {
      transition: none;
    }
  }
</style>
