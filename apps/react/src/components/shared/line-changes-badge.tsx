// Source: src/lib/components/shared/LineChangesBadge.svelte.
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { faPlus, faMinus } from '$lib/icons/phosphor-icon-definitions';
import { formatInteger } from '$lib/i18n/format';

interface LineChangesBadgeProps {
  additions?: number;
  deletions?: number;
  showZero?: boolean;
  size?: 'xxs' | 'xs' | 'sm' | 'md';
  showIcons?: boolean;
  animated?: boolean;
  className?: string;
}

const sizeClasses = {
  xxs: 'text-[0.6rem]',
  xs: 'text-[0.7rem]',
  sm: 'text-sm',
  md: 'text-base',
};
const iconSizes = { xxs: 8, xs: 10, sm: 12, md: 14 };

export function LineChangesBadge({
  additions = 0,
  deletions = 0,
  showZero = false,
  size = 'xs',
  showIcons = false,
  animated = false,
  className = '',
}: LineChangesBadgeProps) {
  const hasAdditions = additions > 0;
  const hasDeletions = deletions > 0;
  if (!(hasAdditions || hasDeletions || showZero)) return null;
  const textClass = sizeClasses[size];
  const iconSize = iconSizes[size];
  // Source FaWrapper normalizes xs/sm to these em sizes.
  const glyphSize = iconSize === 10 || iconSize === 12 ? '0.75em' : '0.875em';

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {(hasAdditions || showZero) && (
        <span
          className={`flex items-center whitespace-nowrap gap-0.5 font-mono ${textClass} ${hasAdditions ? 'text-line-badge-added' : 'text-line-badge-added/30'}`}
        >
          {showIcons && <IconDefinitionIcon icon={faPlus} size={glyphSize} />}{' '}
          <span>+{animated ? <AnimatedNumber value={additions} /> : formatInteger(additions)}</span>
        </span>
      )}{' '}
      {(hasDeletions || showZero) && (
        <span
          className={`flex items-center whitespace-nowrap gap-0.5 font-mono ${textClass} ${hasDeletions ? 'text-line-badge-deleted' : 'text-line-badge-deleted/30'}`}
        >
          {showIcons && <IconDefinitionIcon icon={faMinus} size={glyphSize} />}{' '}
          <span>-{animated ? <AnimatedNumber value={deletions} /> : formatInteger(deletions)}</span>
        </span>
      )}
    </div>
  );
}
