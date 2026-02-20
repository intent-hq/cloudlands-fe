<script lang="ts">
  interface Props {
    size?: number;
    class?: string;
  }

  let { size = 24, class: className = '' }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 100 100"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  class={className}
>
  <!-- Cursor IDE icon - rounded square with cursor pointer -->
  <rect width="100" height="100" rx="22" fill="#000" />

  <!-- Cursor/pointer shape -->
  <path
    d="M30 25 L30 70 L42 58 L52 75 L60 71 L50 54 L65 54 Z"
    fill="white"
  />
</svg>
