<script lang="ts">
  interface Props {
    size?: number;
    class?: string;
    /** Which side the sidebar panel is on. 'left' is the default orientation, 'right' flips it horizontally. */
    side?: 'left' | 'right';
  }

  let { size = 16, class: className = '', side = 'left' }: Props = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  style={side === 'right' ? 'transform: scaleX(-1)' : undefined}
>
  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
  <line x1="9" y1="5" x2="9" y2="19" />
</svg>
