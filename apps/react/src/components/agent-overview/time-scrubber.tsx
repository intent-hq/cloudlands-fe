import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { formatTime as formatClockTime } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';

interface TimeScrubberProps {
  currentTime: string;
  minTime: string;
  maxTime: string;
  isLive: boolean;
  onTimeChange: (time: string) => void;
  onGoLive: () => void;
}

export function TimeScrubber({
  currentTime,
  minTime,
  maxTime,
  isLive,
  onTimeChange,
  onGoLive,
}: TimeScrubberProps) {
  const minMs = new Date(minTime).getTime();
  const maxMs = new Date(maxTime).getTime();
  const currentMs = new Date(currentTime).getTime();
  const [input, setInput] = useState({ currentMs, value: currentMs });
  const currentChanged = !Object.is(input.currentMs, currentMs);
  const sliderValue = currentChanged ? currentMs : input.value;
  if (currentChanged) setInput({ currentMs, value: currentMs });

  function handleInput(ms: number) {
    setInput({ currentMs, value: ms });
    onTimeChange(new Date(ms).toISOString());
  }

  function handleSliderClick() {
    if (isLive) onTimeChange(currentTime);
  }

  function formatTime(isoTime: string): string {
    try {
      return formatClockTime(isoTime, { seconds: true }) || '--:--:--';
    } catch {
      return '--:--:--';
    }
  }

  const progress =
    maxMs <= minMs
      ? 100
      : Math.min(100, Math.max(0, ((sliderValue - minMs) / (maxMs - minMs)) * 100));
  const hasValidRange = maxMs > minMs && !isNaN(minMs) && !isNaN(maxMs);

  return (
    <div className="@container flex flex-wrap items-center gap-3 px-4 py-2.5 bg-background border-t border-border min-w-0">
      <Button
        variant="ghost"
        type="button"
        className={cn(
          'shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all',
          isLive
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
        onClick={onGoLive}
      >
        {isLive ? (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        ) : (
          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
        )}
        <span>
          {isLive
            ? m.agentOverview_timeScrubber_live_label()
            : m.agentOverview_timeScrubber_paused_label()}
        </span>
      </Button>
      <div className="flex-1 flex items-center gap-2 min-w-0 @max-xl:order-last @max-xl:basis-full">
        <span className="shrink-0 text-ui text-subtle font-mono tabular-nums">
          {formatTime(minTime)}
        </span>
        <div className="flex-1 relative h-5 flex items-center min-w-0">
          <div className="absolute inset-x-0 h-1 bg-muted rounded-full" />
          <div
            className="absolute left-0 h-1 bg-foreground/20 rounded-full transition-[width] duration-spring-fast ease-spring-fast motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
          <Slider
            appearance="overlay"
            min={minMs}
            max={maxMs}
            value={sliderValue}
            onValueChange={handleInput}
            onInteractionStart={handleSliderClick}
            disabled={!hasValidRange}
            aria-label={m.agentOverview_timeScrubber_paused_label()}
            className="absolute inset-0 z-10 h-full w-full"
          />
        </div>
        <span className="shrink-0 text-ui text-subtle font-mono tabular-nums">
          {formatTime(maxTime)}
        </span>
      </div>
      <div className="shrink-0 text-ui text-subtle font-mono tabular-nums bg-muted/50 px-2 py-0.5 rounded @max-xl:ml-auto">
        {formatTime(currentTime)}
      </div>
    </div>
  );
}
