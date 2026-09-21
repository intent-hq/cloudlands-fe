<script lang="ts">
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';

  interface Props {
    icon: 'plus' | 'search' | 'close';
  }

  let { icon }: Props = $props();
</script>

{#if icon === 'search'}
  <MagnifyingGlassIcon
    size={14}
    weight="regular"
    mirrored={false}
    class="size-3.5 shrink-0"
    aria-hidden="true"
    focusable="false"
    data-sidebar-action-icon={icon}
  />
{:else}
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
    {:else}
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
    {/if}
  </svg>
{/if}
