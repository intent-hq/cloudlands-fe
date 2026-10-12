// Source: src/lib/components/settings/mcp/McpIcon.svelte.
import { useState } from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import {
  simpleIconsMap,
  customIconUrls,
  customIconSvgs,
  invertInDarkMode,
  faIconMap,
} from '$lib/components/settings/mcp/mcp-icon-data';

export interface McpIconProps {
  iconName: string;
  label: string;
  size?: number;
  className?: string;
}

export function McpIcon({ iconName, label, size = 20, className = '' }: McpIconProps) {
  // The source intentionally retains both flags across prop changes until remount.
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const normalizedName = iconName.toLowerCase();
  const simpleIconSlug = simpleIconsMap[normalizedName];
  const faIcon = faIconMap[normalizedName] || faIconMap.default;
  const inlineSvg = customIconSvgs[normalizedName] || null;
  const needsInvert = invertInDarkMode.has(normalizedName);
  const iconUrl =
    customIconUrls[normalizedName] ||
    (simpleIconSlug ? `https://cdn.simpleicons.org/${simpleIconSlug}` : null);

  return (
    <div
      className={`flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {inlineSvg ? (
        <div
          className={`w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full ${needsInvert ? 'dark:invert' : ''}`}
          // Only canonical, unchanged brand SVG literals enter this branch.
          dangerouslySetInnerHTML={{ __html: inlineSvg }}
        />
      ) : iconUrl && !imageError ? (
        <>
          <img
            src={iconUrl}
            alt={label}
            className={`w-full h-full object-contain ${needsInvert ? 'dark:invert' : ''} ${!imageLoaded ? 'opacity-0' : ''}`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
          {!imageLoaded && (
            <span
              className="type-caption absolute text-subtle font-medium"
              style={{ fontSize: size * 0.45 }}
            >
              {label.charAt(0)}
            </span>
          )}
        </>
      ) : faIconMap[normalizedName] ? (
        <IconDefinitionIcon icon={faIcon} className="text-ghost" style={{ fontSize: size * 0.7 }} />
      ) : (
        <span className="type-caption text-subtle font-medium" style={{ fontSize: size * 0.45 }}>
          {label.charAt(0)}
        </span>
      )}
    </div>
  );
}
