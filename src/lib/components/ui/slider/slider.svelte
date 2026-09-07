<script module lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import type { WithElementRef } from '$lib/utils';

  export type SliderValue = number | [number, number];
  export type SliderValuePosition = 'left' | 'right' | 'top' | 'bottom' | 'tooltip';

  export interface SliderProps extends WithElementRef<
    Omit<HTMLInputAttributes, 'type' | 'value' | 'oninput' | 'onkeydown' | 'onfocus' | 'onblur'>
  > {
    value?: number;
    onValueChange?: (value: number) => void;
    oninput?: HTMLInputAttributes['oninput'];
    onkeydown?: HTMLInputAttributes['onkeydown'];
    onfocus?: HTMLInputAttributes['onfocus'];
    onblur?: HTMLInputAttributes['onblur'];
    formatValue?: (value: number) => string;
    steps?: number[];
    showSteps?: boolean;
    showValue?: boolean;
    valuePosition?: SliderValuePosition;
  }
</script>

<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { crispOut, Spring, springIn } from '$lib/motion';
  import { cn } from '$lib/utils';

  const THUMB_SIZE = 20;
  const THUMB_SIZE_REST = 16;
  const TRACK_HEIGHT = 18;
  const TRACK_INSET = (THUMB_SIZE - TRACK_HEIGHT) / 2;

  let {
    ref = $bindable(null),
    value = $bindable(0),
    min: minProp = 0,
    max: maxProp = 100,
    step: stepProp = 1,
    steps,
    showSteps = false,
    showValue = false,
    valuePosition = 'right',
    disabled = false,
    onValueChange,
    oninput,
    onkeydown,
    onfocus,
    onblur,
    formatValue = String,
    class: className,
    'aria-label': ariaLabel,
    'aria-invalid': ariaInvalid,
    'aria-valuetext': ariaValueText,
    'data-slot': dataSlot = 'slider',
    ...restProps
  }: SliderProps = $props();

  let track: HTMLDivElement;
  let editInput = $state<HTMLInputElement>();
  let pressed = $state(false);
  let hovered = $state(false);
  let focused = $state(false);
  let editing = $state(false);
  let editValue = $state('');
  let previewValue = $state<number | null>(null);
  let tooltipReady = $state(false);
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  const stepValues = $derived.by(() => {
    if (!steps?.length) return null;
    const sorted = [...new Set(steps.filter(Number.isFinite))].sort((a, b) => a - b);
    return sorted.length ? sorted : null;
  });
  const min = $derived(stepValues?.[0] ?? Number(minProp));
  const max = $derived(stepValues?.[stepValues.length - 1] ?? Number(maxProp));
  const step = $derived(Math.max(Number(stepProp) || 1, Number.EPSILON));
  const invalid = $derived(ariaInvalid === true || ariaInvalid === 'true');
  const valueText = $derived(ariaValueText ?? formatValue(value));
  const currentPercent = $derived(toPercent(value));
  const previewPercent = $derived(previewValue === null ? null : toPercent(previewValue));
  const thumbPosition = new Spring(
    untrack(() => currentPercent),
    'moderate',
  );
  const thumbSize = new Spring(THUMB_SIZE_REST, 'fast');

  function nearestStep(candidate: number): number {
    if (!stepValues) return candidate;
    return stepValues.reduce((nearest, option) =>
      Math.abs(option - candidate) < Math.abs(nearest - candidate) ? option : nearest,
    );
  }

  function snap(candidate: number): number {
    const clamped = Math.max(min, Math.min(max, candidate));
    if (stepValues) return nearestStep(clamped);
    const snapped = min + Math.round((clamped - min) / step) * step;
    return Number(Math.max(min, Math.min(max, snapped)).toFixed(12));
  }

  function toPercent(candidate: number): number {
    return max === min ? 0 : Math.max(0, Math.min(1, (candidate - min) / (max - min)));
  }

  function centerStyle(percent: number): string {
    return `calc(${percent * 100}% + ${THUMB_SIZE / 2 - percent * THUMB_SIZE}px)`;
  }

  function thumbStyle(percent: number): string {
    return `calc(${percent * 100}% - ${percent * THUMB_SIZE}px)`;
  }

  function fillWidthStyle(percent: number): string {
    return `calc(${percent * 100}% + ${THUMB_SIZE / 2 - TRACK_INSET - percent * THUMB_SIZE}px)`;
  }

  function previewLeftStyle(): string {
    if (previewPercent === null) return '0px';
    if (previewValue === min) return `${TRACK_INSET}px`;
    return centerStyle(Math.min(currentPercent, previewPercent));
  }

  function previewWidthStyle(): string {
    if (previewPercent === null) return '0px';
    const currentCenter = centerStyle(currentPercent);
    if (previewValue === min) return `calc(${currentCenter} - ${TRACK_INSET}px)`;
    if (previewValue === max) return `calc(100% - ${currentCenter} - ${TRACK_INSET}px)`;
    const distance = Math.abs(previewPercent - currentPercent);
    return `calc(${distance * 100}% - ${distance * THUMB_SIZE}px)`;
  }

  function valueFromClientX(clientX: number): number {
    const rect = track.getBoundingClientRect();
    const layoutWidth = track.offsetWidth || rect.width;
    if (layoutWidth <= THUMB_SIZE || rect.width <= 0) return min;
    const scale = rect.width / layoutWidth;
    const localX = (clientX - rect.left) / scale;
    const percent = Math.max(
      0,
      Math.min(1, (localX - THUMB_SIZE / 2) / (layoutWidth - THUMB_SIZE)),
    );
    return snap(min + percent * (max - min));
  }

  function commitValue(nextValue: number): boolean {
    const next = snap(nextValue);
    if (next === value) return false;
    value = next;
    onValueChange?.(next);
    return true;
  }

  function dispatchInput(nextValue: number) {
    if (!ref) return;
    const input = ref as HTMLInputElement;
    input.value = String(nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function handleNativeInput(event: Event & { currentTarget: EventTarget & HTMLInputElement }) {
    const next = snap(event.currentTarget.valueAsNumber);
    event.currentTarget.value = String(next);
    commitValue(next);
    oninput?.(event);
  }

  function handleFocus(event: FocusEvent & { currentTarget: EventTarget & HTMLInputElement }) {
    focused = event.currentTarget.matches(':focus-visible');
    onfocus?.(event);
  }

  function handleBlur(event: FocusEvent & { currentTarget: EventTarget & HTMLInputElement }) {
    focused = false;
    onblur?.(event);
  }

  function handleKeydown(event: KeyboardEvent & { currentTarget: EventTarget & HTMLInputElement }) {
    onkeydown?.(event);
    if (event.defaultPrevented || disabled) return;
    const stepIndex = stepValues?.indexOf(snap(value)) ?? -1;
    let next: number | undefined;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = stepValues
          ? stepValues[Math.min(stepValues.length - 1, stepIndex + 1)]
          : value + step;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = stepValues ? stepValues[Math.max(0, stepIndex - 1)] : value - step;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      case 'PageUp':
        next = stepValues
          ? stepValues[Math.min(stepValues.length - 1, stepIndex + 10)]
          : value + step * 10;
        break;
      case 'PageDown':
        next = stepValues ? stepValues[Math.max(0, stepIndex - 10)] : value - step * 10;
        break;
    }
    if (next === undefined) return;
    event.preventDefault();
    dispatchInput(snap(next));
  }

  function handlePointerDown(event: PointerEvent) {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    pressed = true;
    const next = valueFromClientX(event.clientX);
    dispatchInput(next);
    void thumbPosition.set(toPercent(next));
    ref?.focus();
    if (event.currentTarget instanceof Element && 'setPointerCapture' in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function handlePointerMove(event: PointerEvent) {
    const next = valueFromClientX(event.clientX);
    if (!pressed) {
      previewValue = next;
      return;
    }
    dispatchInput(next);
    void thumbPosition.set(toPercent(next), { instant: true });
  }

  function handlePointerEnd() {
    if (!pressed) return;
    pressed = false;
    previewValue = null;
    if (ref) ref.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function handlePointerEnter() {
    if (disabled) return;
    hovered = true;
    if (hoverTimeout) clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => (tooltipReady = true), 100);
  }

  function handlePointerLeave() {
    hovered = false;
    tooltipReady = false;
    previewValue = null;
    if (hoverTimeout) clearTimeout(hoverTimeout);
  }

  async function startEditing() {
    if (disabled || valuePosition === 'tooltip') return;
    editValue = String(value);
    editing = true;
    await tick();
    editInput?.focus();
    editInput?.select();
  }

  function commitEditing() {
    if (!editing) return;
    const parsed = Number.parseFloat(editValue);
    editing = false;
    if (!Number.isFinite(parsed)) return;
    const next = snap(parsed);
    dispatchInput(next);
    if (ref) ref.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function cancelEditing() {
    editing = false;
  }

  function handleEditKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEditing();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
    }
  }

  $effect(() => {
    if (!pressed) void thumbPosition.set(currentPercent);
  });

  $effect(() => {
    void thumbSize.set(hovered || pressed ? THUMB_SIZE : THUMB_SIZE_REST);
  });

  onDestroy(() => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
  });
</script>

{#snippet valueDisplay()}
  <span
    data-slot="slider-value"
    class="inline-grid shrink-0 text-[13px] leading-none text-muted-foreground tabular-nums"
    style:font-variation-settings="'wght' 500"
  >
    {#if editing}
      <input
        bind:this={editInput}
        bind:value={editValue}
        type="number"
        {min}
        {max}
        step={stepValues ? 'any' : step}
        aria-label={ariaLabel}
        class="w-[6ch] rounded-(--shape-input-radius) border-b border-border bg-transparent text-center text-foreground outline-none"
        onblur={commitEditing}
        onkeydown={handleEditKeydown}
      />
    {:else}
      <button
        type="button"
        class="cursor-text select-none rounded-(--shape-input-radius) text-inherit"
        {disabled}
        onclick={startEditing}>{formatValue(value)}</button
      >
    {/if}
  </span>
{/snippet}

<div
  data-slot="slider-root"
  data-disabled={disabled || undefined}
  data-invalid={invalid || undefined}
  data-pressed={pressed || undefined}
  class={cn(
    'flex w-full min-w-24 select-none touch-none overflow-visible',
    valuePosition === 'left' || valuePosition === 'right'
      ? 'flex-row items-center gap-2'
      : 'flex-col gap-1',
    disabled && 'pointer-events-none opacity-50',
    className,
  )}
>
  {#if showValue && (valuePosition === 'left' || valuePosition === 'top')}{@render valueDisplay()}{/if}

  <div class="relative min-w-0 flex-1 overflow-visible">
    <input
      bind:this={ref}
      {...restProps}
      type="range"
      {value}
      {min}
      {max}
      step={stepValues ? 'any' : step}
      {disabled}
      aria-label={ariaLabel}
      aria-invalid={ariaInvalid}
      aria-valuenow={value}
      aria-valuetext={valueText}
      data-slot={dataSlot}
      class={cn(
        'peer pointer-events-none absolute inset-0 z-20 h-9 w-full cursor-ew-resize opacity-0',
        'aria-invalid:accent-danger aria-invalid:ring-1 aria-invalid:ring-danger/25',
        className,
      )}
      oninput={handleNativeInput}
      onkeydown={handleKeydown}
      onfocus={handleFocus}
      onblur={handleBlur}
    />

    <div
      bind:this={track}
      data-slot="slider-track"
      role="presentation"
      class="slider-hit-area relative h-9 w-full cursor-ew-resize overflow-visible"
      onpointerenter={handlePointerEnter}
      onpointerleave={handlePointerLeave}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerEnd}
      onpointercancel={handlePointerEnd}
    >
      {#if previewValue !== null && tooltipReady}
        <output
          data-slot="slider-tooltip"
          class="pointer-events-none absolute top-[-20px] z-30 -translate-x-1/2 whitespace-nowrap rounded-(--shape-input-radius) bg-foreground px-2 py-1 text-[12px] text-background tabular-nums"
          style:left={centerStyle(previewPercent ?? 0)}
          style:font-variation-settings="'wght' 500"
          hidden={pressed}
          in:springIn={{ tier: 'fast', y: 4, scale: 0.98 }}
          out:crispOut={{ tier: 'fast', y: 4, scale: 0.98 }}
          aria-hidden="true">{formatValue(previewValue)}</output
        >
      {/if}

      <span
        aria-hidden="true"
        data-slot="slider-track-background"
        class="absolute inset-x-px top-[9px] h-[18px] overflow-hidden rounded-full border border-border bg-transparent"
      ></span>
      <span
        aria-hidden="true"
        data-slot="slider-fill"
        class={cn(
          'absolute top-[9px] left-px h-[18px] rounded-full',
          invalid ? 'bg-danger/30 dark:bg-danger/35' : 'bg-selected/50 dark:bg-accent/40',
        )}
        style:width={fillWidthStyle(thumbPosition.current)}
      ></span>
      <span
        aria-hidden="true"
        data-slot="slider-preview"
        class="pointer-events-none absolute top-[9px] h-[18px] rounded-full bg-accent/40 transition-opacity duration-spring-fast ease-spring-fast motion-reduce:transition-none"
        class:opacity-0={previewValue === null || pressed}
        style:left={previewLeftStyle()}
        style:width={previewWidthStyle()}
      ></span>

      {#if showSteps && stepValues}
        {#each stepValues as pip (pip)}
          <span
            aria-hidden="true"
            data-slot="slider-pip"
            class="pointer-events-none absolute top-1/2 z-10 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/30"
            style:left={centerStyle(toPercent(pip))}
          ></span>
        {/each}
      {/if}

      <span
        aria-hidden="true"
        data-slot="slider-thumb"
        class={cn(
          'pointer-events-none absolute top-1/2 z-20 -translate-y-1/2 rounded-full border border-border bg-background shadow-(--elevation-raised)',
          focused && 'ring-1 ring-focus-ring ring-offset-2 ring-offset-background',
          invalid && 'border-danger',
        )}
        style:left={thumbStyle(thumbPosition.current)}
        style:width={`${thumbSize.current}px`}
        style:height={`${thumbSize.current}px`}
      ></span>
    </div>
  </div>

  {#if showValue && (valuePosition === 'right' || valuePosition === 'bottom')}{@render valueDisplay()}{/if}
</div>

<style>
  .slider-hit-area::before {
    position: absolute;
    inset: 0 -8px;
    content: '';
    cursor: ew-resize;
  }
</style>
