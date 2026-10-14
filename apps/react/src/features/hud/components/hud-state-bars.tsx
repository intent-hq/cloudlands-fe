import { formatNumber } from '$lib/i18n/format';
import '@/lib/motion/hud-attention.css';
import './hud-state-bars.css';

export interface HudStateBar {
  /** Localized row label, supplied by the caller. */
  label: string;
  count: number;
  /** CSS color value for the filled bar segment. */
  color: string;
  /** Blink the label and count; honors the inherited reduced-motion container. */
  blink?: boolean;
  testId?: string;
}

interface HudStateBarsProps {
  bars: HudStateBar[];
  total: number;
}

export function HudStateBars({ bars, total }: HudStateBarsProps) {
  function pct(count: number): string {
    if (!Number.isFinite(total) || total <= 0) return '0%';
    return `${Math.round((Math.max(0, count) / total) * 100)}%`;
  }

  return (
    <div className="hud-state-bars">
      {bars.map((bar) => (
        <div
          key={bar.label}
          className={`hud-state-bar-row${bar.blink ? ' hud-state-bar-blink' : ''}`}
          data-testid={bar.testId}
        >
          <span
            className="hud-state-bar-label"
            style={{ color: bar.blink ? bar.color : undefined }}
          >
            {bar.label}
          </span>
          <div className="hud-state-bar-track">
            <div
              className="hud-state-bar-fill"
              style={{ width: pct(bar.count), background: bar.color }}
            />
          </div>
          <span className="hud-state-bar-count">
            {formatNumber(bar.count, { useGrouping: false, maximumFractionDigits: 20 })}
          </span>
        </div>
      ))}
    </div>
  );
}
