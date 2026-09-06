<script lang="ts">
  /**
   * Diagram Controls Component
   *
   * Provides state navigation controls with a sleek segmented progress indicator
   */
  import type { DiagramState, DiagramNarrative } from '$shared/types/notes-primitives';
  import { Button } from '$lib/components/ui/button';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import Fa from 'svelte-fa';
  import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { m } from '$shared/paraglide/messages.js';
  import { shouldReduceMotion } from '$lib/utils/motion-preference';

  interface Props {
    states: DiagramState[];
    currentStateId?: string;
    onStateChange: (stateId: string) => void;
  }

  let { states, currentStateId, onStateChange }: Props = $props();

  // Helper to normalize narrative (can be string or object)
  function getNarrative(narrative: DiagramNarrative | string | undefined): DiagramNarrative | null {
    if (!narrative) return null;
    if (typeof narrative === 'string') {
      return { text: narrative };
    }
    return narrative;
  }

  // Current state index and state
  let currentIndex = $derived(
    currentStateId ? states.findIndex((s) => s.id === currentStateId) : -1,
  );
  let currentState = $derived(currentIndex >= 0 ? states[currentIndex] : null);

  // Track previous index to determine slide direction
  let previousIndex = $state<number>(-1);
  let slideDirection = $derived<'left' | 'right'>(previousIndex < currentIndex ? 'left' : 'right');

  // Hover state for each segment
  let hoveredIndex = $state<number | null>(null);
  let navigationElement = $state<HTMLDivElement | null>(null);

  function motionDuration(duration: number): number {
    return shouldReduceMotion() ? 0 : duration;
  }

  // Navigation stops at the first and last step so progression stays predictable.
  function goToPrevState() {
    previousIndex = currentIndex;
    if (currentIndex > 0) {
      onStateChange(states[currentIndex - 1].id);
    }
  }

  function goToNextState() {
    previousIndex = currentIndex;
    if (currentIndex < states.length - 1) {
      onStateChange(states[currentIndex + 1].id);
    }
  }

  function goToState(index: number) {
    previousIndex = currentIndex;
    onStateChange(states[index].id);
  }

  function focusStep(index: number) {
    requestAnimationFrame(() => {
      navigationElement
        ?.querySelector<HTMLButtonElement>(`[data-diagram-step-index="${index}"]`)
        ?.focus();
    });
  }

  function handleStepKeydown(e: KeyboardEvent, index: number) {
    if (states.length <= 1) return;

    let nextIndex = index;
    if (e.key === 'ArrowLeft') {
      nextIndex = Math.max(0, index - 1);
    } else if (e.key === 'ArrowRight') {
      nextIndex = Math.min(states.length - 1, index + 1);
    } else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = states.length - 1;
    else return;

    e.preventDefault();
    if (nextIndex === index) return;
    goToState(nextIndex);
    focusStep(nextIndex);
  }
</script>

<div class="diagram-controls">
  <div class="controls-inner">
    <!-- Active state narrative -->
    <div class="narrative-region" aria-live="polite" aria-atomic="true">
      {#if currentState?.narrative}
        {@const narrative = getNarrative(currentState.narrative)}
        {#key currentIndex}
          <div
            class="narrative"
            in:fly={{
              x: slideDirection === 'left' ? 8 : -8,
              duration: motionDuration(150),
              easing: cubicOut,
            }}
            out:fly={{
              x: slideDirection === 'left' ? -8 : 8,
              duration: motionDuration(150),
              easing: cubicOut,
            }}
          >
            {#if narrative?.title}
              <div class="narrative-title">{narrative.title}</div>
            {/if}
            {#if narrative?.text}
              <div class="narrative-text">{narrative.text}</div>
            {/if}
          </div>
        {/key}
      {/if}
    </div>

    <!-- Stepper and navigation -->
    <div
      class="state-navigation"
      role="group"
      aria-label={m.diagram_controls_walkthrough_ariaLabel()}
      bind:this={navigationElement}
    >
      <!-- Stepper dots -->
      <div class="stepper">
        {#each states as state, index (state.id)}
          {@const stateNarrative = getNarrative(state.narrative)}
          <button
            class="stepper-dot"
            class:active={index === currentIndex}
            class:completed={index < currentIndex}
            data-diagram-step-index={index}
            style:anchor-name="--segment-{index}"
            onclick={() => goToState(index)}
            onkeydown={(event) => handleStepKeydown(event, index)}
            onmouseenter={() => (hoveredIndex = index)}
            onmouseleave={() => (hoveredIndex = null)}
            aria-current={index === currentIndex ? 'step' : undefined}
            tabindex={index === currentIndex ? 0 : -1}
            aria-label={m.diagram_controls_state_ariaLabel({
              number: index + 1,
              title:
                stateNarrative?.title ||
                m.diagram_controls_stateNumber_label({ number: index + 1 }),
            })}
          ></button>

          <!-- Hover card -->
          {#if hoveredIndex === index && stateNarrative}
            <HoverCard anchor="--segment-{index}" position="top" class="rounded-md">
              <div class="p-2.5">
                {#if stateNarrative.title}
                  <div class="text-xs font-medium mb-0.5">{stateNarrative.title}</div>
                {/if}
                {#if stateNarrative.text}
                  <div class="text-ui text-subtle leading-snug">
                    {stateNarrative.text}
                  </div>
                {/if}
              </div>
            </HoverCard>
          {/if}
        {/each}
      </div>

      <!-- Step counter -->
      <span
        class="step-counter"
        aria-label={m.diagram_controls_stepCounter_ariaLabel({
          current: currentIndex + 1,
          total: states.length,
        })}>{currentIndex + 1}/{states.length}</span
      >

      <!-- Navigation buttons (hidden for single state) -->
      {#if states.length > 1}
        <div class="navigation-buttons">
          <Button
            variant="ghost"
            size="icon-xs"
            iconOnly
            class="diagram-nav-button"
            onclick={goToPrevState}
            disabled={currentIndex <= 0}
            aria-label={m.diagram_controls_previousStep_ariaLabel()}
          >
            <Fa icon={faChevronLeft} class="text-ui" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            iconOnly
            class="diagram-nav-button"
            onclick={goToNextState}
            disabled={currentIndex >= states.length - 1}
            aria-label={m.diagram_controls_nextStep_ariaLabel()}
          >
            <Fa icon={faChevronRight} class="text-ui" />
          </Button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .diagram-controls {
    pointer-events: auto;
    border-top: 1px solid hsl(var(--border));
    background: hsl(var(--card));
    color: hsl(var(--foreground));
    font-family: var(--font-ui);
  }

  .controls-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-3);
  }

  .narrative-region {
    display: grid;
    flex: 1 1 13rem;
    min-width: 0;
  }

  .narrative {
    grid-column: 1;
    grid-row: 1;
    overflow: hidden;
    text-align: left;
  }

  .narrative-title {
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
    font-weight: var(--text-caption-weight);
    letter-spacing: var(--text-caption-tracking);
  }

  .narrative-text {
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
    letter-spacing: var(--text-caption-tracking);
  }

  .state-navigation,
  .stepper,
  .navigation-buttons {
    display: flex;
    align-items: center;
  }

  .state-navigation {
    flex: none;
    gap: var(--space-1);
    margin-left: auto;
  }

  .stepper {
    gap: 2px;
  }

  .navigation-buttons {
    gap: 2px;
  }

  .step-counter {
    flex: none;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
    font-variant-numeric: tabular-nums;
  }

  .stepper-dot {
    display: grid;
    width: 18px;
    height: 18px;
    place-items: center;
    box-sizing: border-box;
    background: transparent;
    border: none;
    border-radius: var(--radius-full);
    cursor: pointer;
    transition: background var(--motion-fast) var(--ease-standard);
    position: relative;
    padding: 0;
    flex-shrink: 0;
  }

  .stepper-dot::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: hsl(var(--border));
    transition:
      width var(--motion-standard) var(--ease-standard),
      background var(--motion-standard) var(--ease-standard);
  }

  .stepper-dot:hover {
    background: hsl(var(--muted) / 0.55);
  }

  .stepper-dot:focus-visible {
    outline: 2px solid hsl(var(--ring) / 0.55);
    outline-offset: 1px;
    background: hsl(var(--muted) / 0.55);
  }

  .stepper-dot.completed::after {
    background: hsl(var(--primary) / 0.58);
  }

  .stepper-dot.active::after {
    width: 14px;
    background: hsl(var(--primary));
  }

  :global(.diagram-nav-button) {
    color: hsl(var(--muted-foreground));
  }

  :global(.diagram-nav-button:hover) {
    color: hsl(var(--foreground));
  }

  :global(.catalog-reduced-motion) .stepper-dot,
  :global(.catalog-reduced-motion) .stepper-dot::after {
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(html:not(.catalog-full-motion)) .stepper-dot,
    :global(html:not(.catalog-full-motion)) .stepper-dot::after {
      transition: none;
    }
  }
</style>
