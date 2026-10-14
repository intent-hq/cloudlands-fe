interface SidebarIconProps {
  size?: number;
  className?: string;
  side?: 'left' | 'right';
}

export function SidebarIcon({ size = 16, className = '', side = 'left' }: SidebarIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className || undefined}
      style={side === 'right' ? { transform: 'scaleX(-1)' } : undefined}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="5" x2="9" y2="19" />
    </svg>
  );
}
