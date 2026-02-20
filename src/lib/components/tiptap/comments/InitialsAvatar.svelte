<script lang="ts">
  interface Props {
    name?: string;
    size?: number; // px
    class?: string;
  }

  let { name = '', size = 32, class: className = '' }: Props = $props();

  // Derive initials
  let initials = $derived(
    (name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() || '?')
      .join(''),
  );

  // Deterministic soft color from name
  function stringHash(str: string) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
    return Math.abs(h);
  }
  const palette = [
    '#8B5E3C', // brown
    '#6B7280', // slate
    '#3F83F8', // blue
    '#10B981', // green
    '#D97706', // amber
    '#EC4899', // pink
  ];
  let bg = $derived(palette[stringHash(name) % palette.length]);
</script>

<div
  class={`inline-flex items-center justify-center rounded-full text-white font-semibold select-none ${className}`}
  style={`width:${size}px;height:${size}px;background:${bg};font-size:${Math.max(
    10,
    Math.floor(size * 0.45),
  )}px;`}
  aria-hidden="true"
>
  {initials}
</div>
