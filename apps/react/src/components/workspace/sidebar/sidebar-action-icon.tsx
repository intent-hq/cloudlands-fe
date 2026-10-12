// Source: src/lib/components/workspace/sidebar/SidebarActionIcon.svelte.
import { MagnifyingGlassIcon } from '@phosphor-icons/react';

export interface SidebarActionIconProps {
  icon: 'plus' | 'search' | 'close';
}

export function SidebarActionIcon({ icon }: SidebarActionIconProps) {
  if (icon === 'search') {
    return (
      <MagnifyingGlassIcon
        size={14}
        weight="regular"
        mirrored={false}
        className="size-3.5 shrink-0"
        aria-hidden="true"
        focusable="false"
        data-sidebar-action-icon={icon}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 14 14"
      className="size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-sidebar-action-icon={icon}
    >
      <path d={icon === 'plus' ? 'M2.5 7h9M7 2.5v9' : 'M3.5 3.5l7 7M10.5 3.5l-7 7'} />
    </svg>
  );
}
