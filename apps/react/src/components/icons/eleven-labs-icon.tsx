interface ElevenLabsIconProps {
  size?: number;
  className?: string;
}

export function ElevenLabsIcon({ size = 16, className = '' }: ElevenLabsIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className || undefined}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M7 2h4v20H7V2zm6 0h4v20h-4V2z" />
    </svg>
  );
}
