<script lang="ts">
  import type { SVGAttributes } from 'svelte/elements';

  let {
    size = '1em',
    color = 'currentColor',
    ...rest
  }: SVGAttributes<SVGSVGElement> & { size?: number | string; color?: string } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  role="img"
  width={size}
  height={size}
  fill="none"
  stroke={color}
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  viewBox="0 0 24 24"
  focusable="false"
  {...rest}
>
  <path d="M12 2v3m0 9.5v5M4 22a3.62 3.62 0 0 1 3.236-2h9.528A3.62 3.62 0 0 1 20 22" />
  <rect x="4" y="5" width="16" height="9.5" rx="3" />
  <circle cx="9" cy="10" r="1" fill={color} stroke="none" />
  <circle cx="15" cy="10" r="1" fill={color} stroke="none" />
</svg>
