// Source: src/lib/components/tiptap/comments/InitialsAvatar.svelte.
interface InitialsAvatarProps {
  name?: string;
  size?: number;
  className?: string;
}

function stringHash(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return Math.abs(h);
}

const palette = [
  'hsl(var(--agent-avatar-surface-neutral))',
  'hsl(var(--agent-avatar-surface-neutral))',
  'hsl(var(--agent-avatar-surface-waiting))',
  'hsl(var(--agent-avatar-surface-active))',
  'hsl(var(--agent-avatar-surface-attention))',
  'hsl(var(--agent-avatar-surface-neutral))',
];

function InitialsAvatar({ name = '', size = 32, className = '' }: InitialsAvatarProps) {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || '?')
    .join('');
  const bg = palette[stringHash(name) % palette.length];
  const dimension = Number.isFinite(size) && size >= 0 ? `${size}px` : undefined;
  const fontSize = Math.max(10, Math.floor(size * 0.45));
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full text-[hsl(var(--agent-avatar-foreground))] font-semibold select-none ${className}`}
      style={{
        width: dimension,
        height: dimension,
        background: bg,
        fontSize: Number.isFinite(fontSize) ? `${fontSize}px` : undefined,
      }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

export default InitialsAvatar;
