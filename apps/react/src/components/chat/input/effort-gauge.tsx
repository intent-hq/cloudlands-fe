// Source: src/lib/components/chat/input/EffortGauge.svelte.
import { cn } from '@/lib/utils';

export interface EffortGaugeProps {
  value?: number;
  max?: number;
  centered?: boolean;
  size?: 'compact' | 'prominent';
  testId?: string;
  className?: string;
}

export function EffortGauge({
  value = 0,
  max = 1,
  centered = false,
  size = 'compact',
  testId = 'effort-gauge',
  className = '',
}: EffortGaugeProps) {
  const progress = centered ? 0.5 : max > 0 ? Math.min(1, Math.max(0, value / max)) : 0.5;
  const needleAngle = -65 + progress * 130;
  const width = size === 'prominent' ? 28 : 16;
  const height = size === 'prominent' ? 20 : 16;
  const strokeWidth = size === 'prominent' ? 1.5 : 2;

  return (
    <svg
      viewBox="0 0 20 14"
      width={width}
      height={height}
      className={cn('block shrink-0 overflow-visible', className)}
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
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        opacity="0.6"
      />
      <line
        className="transition-transform duration-(--motion-slow) ease-(--ease-emphasized-out) motion-reduce:transition-none"
        data-testid={`${testId}-needle`}
        x1="10"
        y1="11"
        x2="10"
        y2="4.5"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        style={{ transform: `rotate(${needleAngle}deg)`, transformOrigin: '10px 11px' }}
      />
      <circle cx="10" cy="11" r="1.25" fill="currentColor" />
    </svg>
  );
}
