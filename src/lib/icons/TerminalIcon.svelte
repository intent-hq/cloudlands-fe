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
  <path d="m3 4 8 8-8 8m8 0h10" />
</svg>
