<script lang="ts">
  interface Props {
    size?: number;
    class?: string;
  }

  let { size = 16, class: className = '' }: Props = $props();
</script>

<!-- ElevenLabs logo — the "II" wordmark bars -->
<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="currentColor"
  class={className}
  xmlns="http://www.w3.org/2000/svg"
>
  <path d="M7 2h4v20H7V2zm6 0h4v20h-4V2z"></path>
</svg>
