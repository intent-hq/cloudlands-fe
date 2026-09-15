<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Slider } from '$lib/components/ui/slider';
  /**
   * TimeScrubber Component
   *
   * Minimal slider for scrubbing through activity history.
   * ShadCN/Vercel-inspired design.
   */
  import { formatTime as formatClockTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    currentTime: string;
    minTime: string;
    maxTime: string;
    isLive: boolean;
    onTimeChange: (time: string) => void;
    onGoLive: () => void;
  }

  let { currentTime, minTime, maxTime, isLive, onTimeChange, onGoLive }: Props = $props();

  // Convert times to numbers for the range input
  const minMs = $derived(new Date(minTime).getTime());
  const maxMs = $derived(new Date(maxTime).getTime());
  const currentMs = $derived(new Date(currentTime).getTime());

  // Slider value (bindable for two-way binding)
  // svelte-ignore state_referenced_locally - initial value synced by $effect below
  let sliderValue = $state(currentMs);

  // Sync slider value when currentMs changes externally
  $effect(() => {
    sliderValue = currentMs;
  });

  // Handle slider input (during drag)
  function handleInput(ms: number) {
    sliderValue = ms;
    const time = new Date(ms).toISOString();
    onTimeChange(time);
  }

  // Handle clicking on the slider - pause live mode and allow interaction
  function handleSliderClick() {
    if (isLive) {
      // Clicking on slider while live pauses and enables scrubbing
      onTimeChange(currentTime);
    }
  }

  // Format time for display
  function formatTime(isoTime: string): string {
    try {
      return formatClockTime(isoTime, { seconds: true }) || '--:--:--';
    } catch {
      return '--:--:--';
    }
  }

  // Calculate progress percentage
  const progress = $derived.by(() => {
    if (maxMs <= minMs) return 100;
    return Math.min(100, Math.max(0, ((sliderValue - minMs) / (maxMs - minMs)) * 100));
  });

  // Check if we have a valid time range
  const hasValidRange = $derived(maxMs > minMs && !isNaN(minMs) && !isNaN(maxMs));
</script>

<div class="flex items-center gap-3 px-4 py-2.5 bg-background border-t border-border min-w-0">
  <!-- Live toggle -->
  <Button
    variant="ghost"
    type="button"
    class="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all
      {isLive
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'}"
    onclick={onGoLive}
  >
    {#if isLive}
      <span class="relative flex h-2 w-2">
        <span
          class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
        ></span>
        <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
      </span>
    {:else}
      <span class="h-2 w-2 rounded-full bg-muted-foreground/40"></span>
    {/if}
    <span
      >{isLive
        ? m.agentOverview_timeScrubber_live_label()
        : m.agentOverview_timeScrubber_paused_label()}</span
    >
  </Button>

  <!-- Slider container -->
  <div class="flex-1 flex items-center gap-2 min-w-0">
    <span class="shrink-0 text-ui text-subtle font-mono tabular-nums">
      {formatTime(minTime)}
    </span>

    <div class="flex-1 relative h-5 flex items-center min-w-0">
      <!-- Track background -->
      <div class="absolute inset-x-0 h-1 bg-muted rounded-full"></div>

      <!-- Progress fill -->
      <div
        class="absolute left-0 h-1 bg-foreground/20 rounded-full transition-[width] duration-75"
        style="width: {progress}%"
      ></div>

      <Slider
        appearance="overlay"
        min={minMs}
        max={maxMs}
        bind:value={sliderValue}
        onValueChange={handleInput}
        onInteractionStart={handleSliderClick}
        disabled={!hasValidRange}
        aria-label={m.agentOverview_timeScrubber_paused_label()}
        class="absolute inset-0 z-10 h-full w-full"
      />
    </div>

    <span class="shrink-0 text-ui text-subtle font-mono tabular-nums">
      {formatTime(maxTime)}
    </span>
  </div>

  <!-- Current time -->
  <div class="shrink-0 text-ui text-subtle font-mono tabular-nums bg-muted/50 px-2 py-0.5 rounded">
    {formatTime(currentTime)}
  </div>
</div>
