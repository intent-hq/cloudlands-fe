<script lang="ts">
  interface Props {
    icon: 'plus' | 'search' | 'close';
  }

  let { icon }: Props = $props();
</script>

<svg
  viewBox="0 0 14 14"
  class="size-3.5 shrink-0"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
  data-sidebar-action-icon={icon}
>
  {#if icon === 'plus'}
    <path d="M2.5 7h9M7 2.5v9" />
  {:else if icon === 'close'}
    <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
  {:else}
    <circle cx="6" cy="6" r="3.5" />
    <path d="M8.5 8.5l3 3" />
  {/if}
</svg>
