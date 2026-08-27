<script lang="ts">
  /**
   * EffortPicker
   *
   * Session-level reasoning-effort control that sits next to the model picker.
   * Renders only when the session's model advertises `effortLevels` (catalog
   * metadata, PROTOCOL §5.30/§6.7); the trigger shows the current level and a
   * click opens a popover with one discrete slider step per advertised level in
   * catalog order.
   *
   * A centered Auto step maps to an explicit `null`, which clears the session
   * field back to the provider default. Committing a step routes
   * through `applyReasoningEffort`, which owns the session dispatch and the
   * `agent.update` (§5.5) call — the daemon applies the effort on the next
   * prompt send, so queued messages are not snapshotted.
   */

  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { cn } from '$lib/utils';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import Button from '$lib/components/ui/button/button.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { Slider } from '$lib/components/ui/slider';
  import EffortGauge from './EffortGauge.svelte';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
  import { applyReasoningEffort } from '$features/agent/reasoning-effort';
  import { store as appStore } from '$store/renderer/store';
  import { selectAgentReasoningEffort } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { selectAgentModelEffortLevels } from '$store/renderer/slices/model/model-selectors';

  interface Props {
    agentId?: string;
    workspaceId?: string;
    disabled?: boolean;
    class?: string;
    mode?: 'popover' | 'embedded';
    effortLevels?: readonly string[];
    effort?: string | null;
    onEffortChange?: (effort: string | null) => boolean | void | Promise<boolean | void>;
    onkeydown?: (event: KeyboardEvent) => void;
  }

  let {
    agentId,
    workspaceId,
    disabled = false,
    class: className = '',
    mode = 'popover',
    effortLevels = [],
    effort = null,
    onEffortChange,
    onkeydown,
  }: Props = $props();

  const agentIdStore = writable(untrack(() => agentId ?? ''));
  $effect(() => {
    agentIdStore.set(agentId ?? '');
  });

  const effortLevels$ = (
    'withStore' in selectAgentModelEffortLevels
      ? selectAgentModelEffortLevels.withStore(appStore)
      : selectAgentModelEffortLevels
  )(agentIdStore);
  const reasoningEffort$ = (
    'withStore' in selectAgentReasoningEffort
      ? selectAgentReasoningEffort.withStore(appStore)
      : selectAgentReasoningEffort
  )(agentIdStore);

  /** Provider-level ids get a translated label; unknown levels render verbatim. */
  const LEVEL_LABELS: Record<string, () => string> = {
    minimal: () => m.chat_effortPicker_level_minimal(),
    low: () => m.chat_effortPicker_level_low(),
    medium: () => m.chat_effortPicker_level_medium(),
    high: () => m.chat_effortPicker_level_high(),
    xhigh: () => m.chat_effortPicker_level_xhigh(),
    max: () => m.chat_effortPicker_level_max(),
  };

  function levelLabel(level: string): string {
    return LEVEL_LABELS[level]?.() ?? level;
  }

  type Step = { value: string | null; label: string; position: number };

  const SLIDER_MAX = 100;
  const SLIDER_MIDPOINT = SLIDER_MAX / 2;
  const MIDDLE_LEVEL_POSITION = SLIDER_MIDPOINT - 1;

  const embedded = $derived(mode === 'embedded');
  const levels = $derived(embedded ? [...effortLevels] : ($effortLevels$ ?? []));
  const hasLevels = $derived((embedded || !!agentId) && levels.length > 0);

  const steps = $derived.by<Step[]>(() => {
    const supportedSteps: Step[] = levels.map((level, index) => {
      const intendedPosition =
        levels.length === 1 ? 0 : Math.round((index / (levels.length - 1)) * SLIDER_MAX);
      return {
        value: level,
        label: levelLabel(level),
        position: intendedPosition === SLIDER_MIDPOINT ? MIDDLE_LEVEL_POSITION : intendedPosition,
      };
    });
    supportedSteps.push({
      value: null,
      label: m.chat_effortPicker_level_auto(),
      position: SLIDER_MIDPOINT,
    });
    return supportedSteps.sort((left, right) => left.position - right.position);
  });

  // An effort the newly selected model does not advertise keeps the underlying
  // provider-default value without guessing which concrete level the provider uses.
  const persistedValue = $derived(embedded ? effort : ($reasoningEffort$ ?? null));
  const currentValue = $derived(
    persistedValue && levels.includes(persistedValue) ? persistedValue : null,
  );
  const currentIndex = $derived(
    Math.max(
      0,
      steps.findIndex((step) => step.value === currentValue),
    ),
  );
  const currentLabel = $derived(steps[currentIndex]?.label ?? '');

  function gaugeValue(index: number): number {
    const value = steps[index]?.value;
    return value ? Math.max(0, levels.indexOf(value)) : 0;
  }

  let isOpen = $state(false);
  let triggerRef = $state<HTMLButtonElement | null>(null);
  let popoverRef = $state<HTMLDivElement | null>(null);
  let popoverStyle = $state('');
  let sliderIndex = $state(0);
  let labelDirection = $state<'up' | 'down'>('up');
  const sliderPosition = $derived(steps[sliderIndex]?.position ?? SLIDER_MIDPOINT);

  function preview(index: number) {
    if (index === sliderIndex) return;
    labelDirection = index > sliderIndex ? 'up' : 'down';
    sliderIndex = index;
  }

  function nearestStepIndex(position: number): number {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [index, step] of steps.entries()) {
      const distance = Math.abs(step.position - position);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    }
    return nearestIndex;
  }

  $effect(() => {
    if (!embedded) return;
    sliderIndex = currentIndex;
    labelDirection = 'up';
  });

  function updatePosition() {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    popoverStyle = `position: fixed; bottom: ${viewportHeight - rect.top + 4}px; left: ${rect.left}px; width: 260px;`;
  }

  function toggleOpen() {
    if (disabled) return;
    isOpen = !isOpen;
    if (isOpen) {
      sliderIndex = currentIndex;
      labelDirection = 'up';
      updatePosition();
    }
  }

  function handleClickOutside(event: MouseEvent) {
    if (!isOpen) return;
    const target = event.target as Node;
    if (triggerRef?.contains(target) || popoverRef?.contains(target)) return;
    isOpen = false;
  }

  $effect(() => {
    if (!isOpen) return;
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  });

  $effect(() => {
    if (!isOpen) return;
    return pushEscapeLayer(() => {
      isOpen = false;
    });
  });

  async function commit(index: number) {
    const step = steps[index];
    if (!step || disabled || (!embedded && !workspaceId)) return;

    // Compare against the persisted field, not `currentValue`: an effort the
    // model no longer advertises maps to the provider-default position, which
    // must still clear that stale value on the daemon.
    const previous = persistedValue ?? null;
    if (step.value === previous) return;

    const applied = embedded
      ? await onEffortChange?.(step.value)
      : agentId && workspaceId
        ? await applyReasoningEffort(agentId, workspaceId, step.value, previous)
        : false;
    if (applied === false) sliderIndex = currentIndex;
  }

  function handleSliderKeydown(event: KeyboardEvent) {
    onkeydown?.(event);
    if (event.defaultPrevented) return;

    let nextIndex: number | undefined;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      nextIndex = Math.max(0, sliderIndex - 1);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      nextIndex = Math.min(steps.length - 1, sliderIndex + 1);
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = steps.length - 1;
    }

    if (nextIndex === undefined) return;
    event.preventDefault();
    preview(nextIndex);
    void commit(nextIndex);
  }
</script>

{#snippet sliderContent()}
  {#if embedded}
    <div class="flex items-center justify-between gap-2">
      <div class="type-caption truncate text-muted-foreground">
        {m.chat_effortPicker_nextSend_description()}
      </div>
      <EffortGauge
        value={gaugeValue(sliderIndex)}
        max={levels.length - 1}
        centered={steps[sliderIndex]?.value === null}
      />
    </div>
  {:else}
    <div class="flex items-center justify-between gap-2">
      <div class="type-body font-medium">{m.chat_effortPicker_title_label()}</div>
      <span
        class="type-caption flex h-4 max-w-28 items-center overflow-hidden font-medium text-foreground"
        data-testid="effort-current-value"
      >
        {#key sliderIndex}
          <span class="effort-value-label block truncate" data-motion-direction={labelDirection}>
            {steps[sliderIndex]?.label}
          </span>
        {/key}
      </span>
    </div>
    <div class="type-caption mt-0.5 text-subtle">
      {m.chat_effortPicker_nextSend_description()}
    </div>
  {/if}

  <div class={cn('relative', embedded ? 'mt-2' : 'mt-2.5')}>
    <Slider
      min="0"
      max={SLIDER_MAX}
      step="1"
      value={sliderPosition}
      {disabled}
      onkeydown={handleSliderKeydown}
      aria-label={m.chat_effortPicker_slider_ariaLabel()}
      aria-valuetext={steps[sliderIndex]?.label}
      onValueChange={(position) => {
        preview(nearestStepIndex(position));
      }}
      onchange={(event) => {
        const position = Number((event.currentTarget as HTMLInputElement).value);
        const index = nearestStepIndex(position);
        preview(index);
        void commit(index);
      }}
    />
    <div
      class="pointer-events-none absolute inset-x-px top-1/2 -translate-y-1/2"
      aria-hidden="true"
    >
      {#each steps as step (step.value ?? 'provider-default')}
        <span
          class="flex h-3 w-px items-center justify-center"
          style={`position: absolute; left: ${step.position}%; transform: translateX(-50%);`}
          data-testid="effort-slider-tick"
          data-effort-level={step.value ?? 'provider-default'}
          data-slider-position={step.position}
        >
          <span
            class="h-2 w-px shrink-0 rounded-full bg-muted-foreground/55"
            data-testid="effort-slider-tick-marker"
          ></span>
        </span>
      {/each}
    </div>
  </div>
{/snippet}

{#if hasLevels}
  {#if embedded}
    <div class={className} data-testid="effort-picker-content">
      {@render sliderContent()}
    </div>
  {:else}
    <TooltipShortcut
      label={m.chat_effortPicker_trigger_tooltip({ level: currentLabel })}
      side="top"
    >
      <Button
        bind:ref={triggerRef}
        variant="ghost-light"
        size="icon-sm"
        onclick={toggleOpen}
        disabled={disabled || !workspaceId}
        aria-label={m.chat_effortPicker_trigger_ariaLabel({ level: currentLabel })}
        aria-haspopup="true"
        aria-expanded={isOpen}
        class={cn('shrink-0', className)}
        data-testid="effort-picker-trigger"
      >
        <EffortGauge
          value={gaugeValue(isOpen ? sliderIndex : currentIndex)}
          max={levels.length - 1}
          centered={(isOpen ? steps[sliderIndex]?.value : currentValue) === null}
        />
      </Button>
    </TooltipShortcut>

    {#if isOpen}
      <Portal zIndex={60}>
        <div
          bind:this={popoverRef}
          class={cn(
            'rounded-lg border border-border px-3 py-2.5',
            'bg-popover text-popover-foreground shadow-lg',
          )}
          style={popoverStyle}
          role="dialog"
          aria-label={m.chat_effortPicker_popover_ariaLabel()}
        >
          {@render sliderContent()}
        </div>
      </Portal>
    {/if}
  {/if}
{/if}

<style>
  .effort-value-label {
    animation: effort-value-enter var(--motion-slow) var(--ease-emphasized-out);
  }

  .effort-value-label[data-motion-direction='up'] {
    --effort-value-offset: 120%;
    --effort-bounce: -12%;
  }

  .effort-value-label[data-motion-direction='down'] {
    --effort-value-offset: -120%;
    --effort-bounce: 12%;
  }

  @keyframes effort-value-enter {
    0% {
      opacity: 0;
      transform: translateY(var(--effort-value-offset)) scale(0.75);
    }
    50% {
      opacity: 1;
      transform: translateY(var(--effort-bounce)) scale(1.08);
    }
    75% {
      transform: translateY(calc(var(--effort-bounce) * -0.3)) scale(0.98);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .effort-value-label {
      animation: none;
    }
  }
</style>
