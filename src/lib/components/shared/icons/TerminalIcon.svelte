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
  <!-- Terminal icon - black rounded square -->
  <rect width="100" height="100" rx="22" fill="#1E1E1E" />

  <!-- Command prompt chevron -->
  <path
    d="M25 35 L45 50 L25 65"
    stroke="#FFFFFF"
    stroke-width="6"
    stroke-linecap="round"
    stroke-linejoin="round"
    fill="none"
  />

  <!-- Cursor/underscore -->
  <rect x="50" y="60" width="25" height="5" rx="2" fill="#FFFFFF" />
</svg>
