import { cn } from '@/lib/utils';
import { formatNumber } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';

interface LineChangeStatsProps {
  additions?: number;
  deletions?: number;
  showZero?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  inline?: boolean;
  loading?: boolean;
  className?: string;
}

export function LineChangeStats({
  additions = 0,
  deletions = 0,
  showZero = false,
  size = 'sm',
  inline = true,
  loading = false,
  className = '',
}: LineChangeStatsProps) {
  const shouldShow = showZero || additions > 0 || deletions > 0 || loading;
  let sizeClasses: string;
  switch (size) {
    case 'xs':
      sizeClasses = 'text-ui gap-1';
      break;
    case 'md':
      sizeClasses = 'text-sm gap-2';
      break;
    case 'lg':
      sizeClasses = 'text-base gap-2.5';
      break;
    case 'sm':
    default:
      sizeClasses = 'text-xs gap-1.5';
  }

  function formatCompact(num: number): string {
    return formatNumber(num, { notation: 'compact' });
  }

  if (!shouldShow) return null;

  return (
    <div
      className={cn(
        'whitespace-nowrap',
        inline ? 'inline-flex' : 'flex',
        'items-center font-mono',
        sizeClasses,
        className,
      )}
    >
      {loading ? (
        <span className="text-subtle animate-pulse">
          {m.shared_lineChangeStats_calculating_label()}
        </span>
      ) : (
        <>
          {(additions > 0 || showZero) && (
            <span className="text-line-stats-added flex items-center gap-0.5">
              <span className="opacity-70">+</span> <span>{formatCompact(additions)}</span>
            </span>
          )}{' '}
          {(deletions > 0 || showZero) && (
            <span className="text-line-stats-deleted flex items-center gap-0.5">
              <span className="opacity-70">-</span> <span>{formatCompact(deletions)}</span>
            </span>
          )}{' '}
          {!additions && !deletions && !showZero && (
            <span className="text-subtle">{m.shared_lineChangeStats_noChanges_label()}</span>
          )}
        </>
      )}
    </div>
  );
}
