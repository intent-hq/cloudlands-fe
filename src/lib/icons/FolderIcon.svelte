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
  <path
    d="M5 4h4.465a1 1 0 0 1 .832.445L12 7h7a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z"
  />
</svg>
