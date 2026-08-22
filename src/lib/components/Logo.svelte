<script lang="ts">
  // Intent burst brand mark, vectorized from src/assets/icons/app-icon/Icon-1024.png
  interface Props {
    width?: number;
    class?: string;
  }

  let { width = 24, class: className = '' }: Props = $props();
</script>

<svg
  {width}
  viewBox="0 0 24 24"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  class={className}
  aria-hidden="true"
>
  <path
    d="M12 15.82L12 23.76M4.44 21L8.35 16.35A1.96 1.96 0 0 0 6.4 12.99L0.42 14.04M1.82 6.12L7.08 9.16A1.96 1.96 0 0 0 10.06 6.66L7.98 0.95M16.02 0.95L13.94 6.66A1.96 1.96 0 0 0 16.92 9.16L22.18 6.12M23.58 14.04L17.6 12.99A1.96 1.96 0 0 0 15.65 16.35L19.56 21"
    stroke="currentColor"
    stroke-width="2.06"
    stroke-linecap="butt"
    stroke-linejoin="round"
  />
</svg>
