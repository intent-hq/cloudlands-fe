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
  <!-- Windsurf icon - green gradient background with W shape -->
  <defs>
    <linearGradient id="windsurfGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0EA5E9" />
      <stop offset="100%" stop-color="#22C55E" />
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="22" fill="url(#windsurfGrad)" />

  <!-- Stylized wave/wind -->
  <path
    d="M20 60 Q35 35, 50 60 Q65 85, 80 60"
    stroke="white"
    stroke-width="8"
    fill="none"
    stroke-linecap="round"
  />
  <path
    d="M20 40 Q35 15, 50 40 Q65 65, 80 40"
    stroke="white"
    stroke-width="6"
    fill="none"
    stroke-linecap="round"
    opacity="0.7"
  />
</svg>
