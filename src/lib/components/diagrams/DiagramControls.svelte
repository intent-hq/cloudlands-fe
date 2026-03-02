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

  // Navigation (with cycling)
  function goToPrevState() {
    previousIndex = currentIndex;
    if (currentIndex > 0) {
      onStateChange(states[currentIndex - 1].id);
    } else if (currentIndex === 0) {
      // Cycle to last state
      onStateChange(states[states.length - 1].id);
    }
  }

  function goToNextState() {
    previousIndex = currentIndex;
    if (currentIndex < states.length - 1) {
      onStateChange(states[currentIndex + 1].id);
    } else if (currentIndex === states.length - 1) {
      // Cycle to first state
      onStateChange(states[0].id);
    }
  }

  function goToState(index: number) {
    previousIndex = currentIndex;
    onStateChange(states[index].id);
  }
</script>

<div class="diagram-controls bg-background border-t border-border">
  <div class="flex items-center justify-between gap-3 px-3 py-2">
    <!-- Active state narrative -->
    <div class="flex-1 min-w-0 grid">
      {#if currentState?.narrative}
        {@const narrative = getNarrative(currentState.narrative)}
        {#key currentIndex}
          <div
            class="text-left overflow-hidden col-span-full row-span-full"
            in:fly={{
              x: slideDirection === 'left' ? 100 : -100,
              duration: 300,
              easing: cubicOut,
            }}
            out:fly={{
              x: slideDirection === 'left' ? -100 : 100,
              duration: 300,
              easing: cubicOut,
            }}
          >
            {#if narrative?.title}
              <div class="text-sm font-medium">{narrative.title}</div>
            {/if}
            {#if narrative?.text}
              <div class="text-xs text-subtle">{narrative.text}</div>
            {/if}
          </div>
        {/key}
      {/if}
    </div>

    <!-- Stepper and navigation -->
    <div class="flex items-center gap-1.5 flex-none">
      <!-- Stepper dots -->
      <div class="flex items-center gap-1.5">
        {#each states as state, index (state.id)}
          {@const stateNarrative = getNarrative(state.narrative)}
          <button
            class="stepper-dot"
            class:active={index === currentIndex}
            class:completed={index < currentIndex}
            style:anchor-name="--segment-{index}"
            onclick={() => goToState(index)}
            onmouseenter={() => (hoveredIndex = index)}
            onmouseleave={() => (hoveredIndex = null)}
            aria-label="State {index + 1}: {stateNarrative?.title || 'State ' + (index + 1)}"
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

      <!-- Navigation buttons -->
      <div class="flex items-center gap-0.5 sticky left-0">
        <Button
          variant="ghost"
          size="sm"
          class="h-5 w-5 p-0 opacity-60 hover:opacity-100"
          onclick={goToPrevState}
        >
          <Fa icon={faChevronLeft} class="text-ui" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-5 w-5 p-0 opacity-60 hover:opacity-100"
          onclick={goToNextState}
        >
          <Fa icon={faChevronRight} class="text-ui" />
        </Button>
      </div>
    </div>
  </div>
</div>

<style>
  .diagram-controls {
    pointer-events: auto;
  }

  .stepper-dot {
    width: 6px;
    height: 6px;
    background: hsl(var(--border) / 0.6);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    padding: 0;
    flex-shrink: 0;
  }

  .stepper-dot:hover {
    background: hsl(var(--muted-foreground) / 0.5);
    transform: scale(1.2);
  }

  .stepper-dot.completed {
    background: hsl(var(--primary) / 0.6);
  }

  .stepper-dot.active {
    width: 24px;
    background: hsl(var(--primary));
    border-radius: 12px;
  }

  .stepper-dot.active:hover {
    transform: scale(1.05);
  }
</style>
