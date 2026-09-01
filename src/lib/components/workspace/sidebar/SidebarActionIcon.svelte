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
    <path d="M2.75 7h8.5M7 2.75v8.5" />
  {:else if icon === 'close'}
    <path d="M2.53 2.53l8.94 8.94M11.47 2.53l-8.94 8.94" />
  {:else}
    <circle cx="6" cy="6" r="3.25" />
    <path d="M8.3 8.3l3.17 3.17" />
  {/if}
</svg>
