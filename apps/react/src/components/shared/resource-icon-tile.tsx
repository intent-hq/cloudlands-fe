// Source: src/lib/components/shared/ResourceIconTile.svelte.
import { CodeIcon, TextAlignLeftIcon, type Icon } from '@phosphor-icons/react';
import type { ResourceIconKind } from '$lib/components/shared/resource-icon';
import './resource-icon-tile.css';

export interface ResourceIconTileProps {
  kind: ResourceIconKind;
  variant?: 'standard' | 'emphasized';
  className?: string;
}

// RESOURCE_ICON_BY_KIND resolved through the source FaWrapper Phosphor mapping.
const resourceIcons = {
  note: { component: TextAlignLeftIcon, name: 'align-left' },
  changes: { component: CodeIcon, name: 'code' },
} satisfies Record<ResourceIconKind, { component: Icon; name: string }>;

export function ResourceIconTile({
  kind,
  variant = 'standard',
  className = '',
}: ResourceIconTileProps) {
  const { component: Glyph, name } = resourceIcons[kind];

  return (
    <span
      className={`resource-icon-tile react-resource-icon-tile ${className}`}
      data-resource-icon-tile=""
      data-resource-kind={kind}
      data-resource-icon-variant={variant}
      aria-hidden="true"
    >
      <span className="resource-icon-glyph" data-resource-icon-glyph="">
        <Glyph
          size="1em"
          weight="regular"
          mirrored={false}
          data-icon={name}
          data-weight="regular"
          aria-hidden="true"
        />
      </span>
    </span>
  );
}
