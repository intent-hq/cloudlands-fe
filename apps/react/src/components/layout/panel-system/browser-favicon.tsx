// Source: src/lib/components/layout/panel-system/BrowserFavicon.svelte.
import { GlobeIcon } from '@phosphor-icons/react';

export interface BrowserFaviconProps {
  faviconUrl?: string;
  size?: number;
  fallbackClass?: string;
}

export function BrowserFavicon({
  faviconUrl,
  size = 16,
  fallbackClass = 'text-muted-foreground',
}: BrowserFaviconProps) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: `${size}px`, height: `${size}px` }}
      aria-hidden="true"
    >
      <GlobeIcon
        size={`${size}px`}
        weight="regular"
        mirrored={false}
        className={fallbackClass}
        data-icon="globe"
        data-weight="regular"
        aria-hidden="true"
      />
      {faviconUrl ? (
        <img
          key={faviconUrl}
          src={faviconUrl}
          alt=""
          width={size}
          height={size}
          className="absolute inset-0 size-full rounded-sm object-contain opacity-0"
          onLoad={(event) => {
            event.currentTarget.style.opacity = '1';
          }}
          onError={(event) => {
            event.currentTarget.style.opacity = '0';
          }}
        />
      ) : null}
    </span>
  );
}
