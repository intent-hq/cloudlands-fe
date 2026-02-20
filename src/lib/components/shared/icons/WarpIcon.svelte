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
  viewBox="0 0 21 18"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  class="text-black dark:text-white {className}"
>
  <!-- Warp logo - left part only -->
  <path d="M 10.651 0 L 18.482 0 C 19.749 0 20.777 1.059 20.777 2.365 L 20.777 11.545 C 20.777 12.851 19.749 13.91 18.482 13.91 L 7.276 13.91 Z" fill="currentColor"/>
  <path d="M 8.583 2.663 L 2.276 2.663 C 1.019 2.663 0 3.721 0 5.027 L 0 14.208 C 0 15.514 1.019 16.573 2.275 16.573 L 10.039 16.573 L 10.35 15.279 L 5.548 15.279 Z" fill="currentColor"/>
</svg>
