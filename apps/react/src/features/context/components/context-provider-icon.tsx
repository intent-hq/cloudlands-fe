import {
  CONTEXT_ITEM_PROVIDERS,
  type ContextItemType,
  type ContextProvider,
} from '../../../../../../src/features/context/types';
import { faFileAlt, faGlobe } from '$lib/icons/phosphor-icon-definitions';
import { GitHubIcon } from '@/components/icons/github-icon';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { LinearIcon } from '@/components/icons/linear-icon';
import { SentryIcon } from '@/components/icons/sentry-icon';

interface ContextProviderIconProps {
  provider?: ContextProvider;
  itemType?: ContextItemType;
  size?: number;
  className?: string;
}

export function ContextProviderIcon({
  provider,
  itemType,
  size = 16,
  className = '',
}: ContextProviderIconProps) {
  const effectiveProvider = provider ?? (itemType ? CONTEXT_ITEM_PROVIDERS[itemType] : 'internal');

  if (effectiveProvider === 'linear') return <LinearIcon size={size} className={className} />;
  if (effectiveProvider === 'github') return <GitHubIcon size={size} className={className} />;
  if (effectiveProvider === 'sentry') return <SentryIcon size={size} className={className} />;

  return (
    <span
      className={className || undefined}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <IconDefinitionIcon
        icon={effectiveProvider === 'browser' ? faGlobe : faFileAlt}
        size={`${size}px`}
      />
    </span>
  );
}
