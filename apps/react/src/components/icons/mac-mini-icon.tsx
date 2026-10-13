import type { SVGProps } from 'react';

export function MacMiniIcon({
  size = '1em',
  color = 'currentColor',
  className = '',
  ...rest
}: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth="16"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-owns-stroke=""
      className={className}
      {...rest}
    >
      <rect x="32" y="72" width="192" height="112" rx="24" />
      <path d="M48 152h160" />
      <circle cx="192" cy="168" r="4" fill={color} stroke="none" />
    </svg>
  );
}
