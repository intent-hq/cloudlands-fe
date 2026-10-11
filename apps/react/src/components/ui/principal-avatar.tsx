import { useState, type ImgHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface PrincipalAvatarProps {
  avatarUrl?: string | null;
  label: string;
  size?: number;
  className?: string;
  referrerPolicy?: ImgHTMLAttributes<HTMLImageElement>['referrerPolicy'];
  testid?: string;
  fill?: boolean;
}

export function PrincipalAvatar({
  avatarUrl = null,
  label,
  size = 24,
  className,
  referrerPolicy,
  testid,
  fill = false,
}: PrincipalAvatarProps) {
  const [image, setImage] = useState({ url: avatarUrl, failed: false });
  const failed = image.url === avatarUrl && image.failed;
  if (image.url !== avatarUrl) setImage({ url: avatarUrl, failed: false });
  const dimension = fill ? undefined : `${size}px`;
  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        aria-hidden="true"
        className={cn(fill ? 'h-full w-full object-cover' : 'shrink-0 rounded-full', className)}
        style={{ width: dimension, height: dimension }}
        loading="lazy"
        referrerPolicy={referrerPolicy}
        data-testid={testid}
        onError={() => setImage({ url: avatarUrl, failed: true })}
      />
    );
  }
  return (
    <span
      className={cn(
        fill
          ? 'grid h-full w-full place-items-center'
          : 'grid shrink-0 place-items-center rounded-full bg-muted type-caption text-foreground',
        className,
      )}
      style={{ width: dimension, height: dimension }}
      aria-hidden="true"
      data-testid={testid === undefined ? undefined : `${testid}-fallback`}
    >
      {label.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  );
}
