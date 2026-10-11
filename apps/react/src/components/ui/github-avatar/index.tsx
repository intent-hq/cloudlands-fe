import { useState, type ReactNode } from 'react';

export interface GitHubAvatarProps {
  identity: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
  alt?: string;
  fallback?: ReactNode;
}

export function GitHubAvatar({ identity, avatarUrl, size = 16, ...props }: GitHubAvatarProps) {
  const src =
    avatarUrl || `https://github.com/${encodeURIComponent(identity)}.png?size=${size * 2}`;
  return <AvatarImage key={JSON.stringify([identity, src])} src={src} size={size} {...props} />;
}

/** Remounting only when identity or URL changes retries even a previously failed identity. */
function AvatarImage({
  src,
  size,
  className = '',
  alt,
  fallback,
}: Omit<GitHubAvatarProps, 'identity' | 'avatarUrl'> & { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={alt ?? ''}
      aria-hidden={alt === undefined || undefined}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
