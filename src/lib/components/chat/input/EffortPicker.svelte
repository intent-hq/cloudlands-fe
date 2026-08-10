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
   * A leading "Default" step maps to an explicit `null`, which clears the
   * session field back to the provider default. Committing a step routes
   * through `applyReasoningEffort`, which owns the session dispatch and the
   * `agent.update` (§5.5) call — the daemon applies the effort on the next
   * prompt send, so queued messages are not snapshotted.
   */

  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faGaugeHigh } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import Button from '$lib/components/ui/button/button.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
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
  }

  let { agentId, workspaceId, disabled = false, class: className = '' }: Props = $props();

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

  type Step = { value: string | null; label: string };

  const levels = $derived($effortLevels$ ?? []);
  const hasLevels = $derived(!!agentId && levels.length > 0);

  const steps = $derived<Step[]>([
    { value: null, label: m.chat_effortPicker_level_default() },
    ...levels.map((level) => ({ value: level, label: levelLabel(level) })),
  ]);

  // An effort the newly selected model does not advertise falls back to the
  // default position; the daemon/adapter reconciliation stays authoritative.
  const currentValue = $derived(
    $reasoningEffort$ && levels.includes($reasoningEffort$) ? $reasoningEffort$ : null,
  );
  const currentIndex = $derived(Math.max(0, steps.findIndex((step) => step.value === currentValue)));
  const currentLabel = $derived(steps[currentIndex]?.label ?? '');

  let isOpen = $state(false);
  let triggerRef = $state<HTMLButtonElement | null>(null);
  let popoverRef = $state<HTMLDivElement | null>(null);
  let popoverStyle = $state('');
  let sliderIndex = $state(0);

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
    if (!step || !agentId || !workspaceId) return;

    // Compare against the persisted field, not `currentValue`: an effort the
    // model no longer advertises also maps to the "Default" position, and
    // picking Default must still clear that stale value on the daemon.
    const previous = $reasoningEffort$ ?? null;
    if (step.value === previous) return;

    const applied = await applyReasoningEffort(agentId, workspaceId, step.value, previous);
    if (!applied) sliderIndex = currentIndex;
  }
</script>

{#if hasLevels}
  <TooltipShortcut label={m.chat_effortPicker_trigger_tooltip({ level: currentLabel })} side="top">
    <Button
      bind:ref={triggerRef}
      variant="ghost-light"
      size="xs"
      onclick={toggleOpen}
      disabled={disabled || !workspaceId}
      aria-label={m.chat_effortPicker_trigger_ariaLabel({ level: currentLabel })}
      aria-haspopup="true"
      aria-expanded={isOpen}
      class={cn('shrink-0', className)}
      data-testid="effort-picker-trigger"
    >
      <Fa icon={faGaugeHigh} size="sm" />
      <span class="truncate">{currentLabel}</span>
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
        <div class="font-medium text-sm">{m.chat_effortPicker_title_label()}</div>
        <div class="text-xs text-subtle">{m.chat_effortPicker_nextSend_description()}</div>

        <input
          type="range"
          min="0"
          max={steps.length - 1}
          step="1"
          value={sliderIndex}
          class="w-full mt-2.5"
          aria-label={m.chat_effortPicker_slider_ariaLabel()}
          aria-valuetext={steps[sliderIndex]?.label}
          oninput={(event) => {
            sliderIndex = Number((event.currentTarget as HTMLInputElement).value);
          }}
          onchange={(event) => {
            void commit(Number((event.currentTarget as HTMLInputElement).value));
          }}
        />

        <div class="flex justify-between gap-1 mt-1">
          {#each steps as step, index (step.value ?? 'default')}
            <span
              class={cn(
                'text-xs',
                index === sliderIndex ? 'text-foreground font-medium' : 'text-subtle',
              )}
              data-testid="effort-step-label"
            >
              {step.label}
            </span>
          {/each}
        </div>
      </div>
    </Portal>
  {/if}
{/if}
