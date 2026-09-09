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
  <rect x="32" y="72" width="192" height="112" rx="24" />
  <path d="M48 152h160" />
  <circle cx="192" cy="168" r="4" fill={color} stroke="none" />
</svg>
