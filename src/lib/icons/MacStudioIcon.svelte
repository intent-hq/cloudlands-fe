<script lang="ts">
  import type { SVGAttributes } from 'svelte/elements';

  let {
    size = '1em',
    color = 'currentColor',
    class: className = '',
    ...rest
  }: SVGAttributes<SVGSVGElement> & { size?: number | string; color?: string } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 256 256"
  width={size}
  height={size}
  fill="none"
  stroke={color}
  stroke-width="16"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  {...rest}
>
  <rect x="48" y="40" width="160" height="176" rx="24" />
  <path d="M48 152h160M72 176h112" />
  <circle cx="176" cy="192" r="4" fill={color} stroke="none" />
</svg>
