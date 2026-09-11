<script lang="ts">
  interface Props {
    icon: 'plus' | 'search' | 'close';
  }

  let { icon }: Props = $props();
</script>

<svg
  viewBox="0 0 14 14"
  class="size-3.5! shrink-0"
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
    <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" />
  {:else}
    <circle cx="5.75" cy="5.75" r="3.25" />
    <path d="M8.05 8.05l3.45 3.45" />
  {/if}
</svg>
