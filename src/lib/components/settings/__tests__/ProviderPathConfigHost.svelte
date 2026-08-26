<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import ProviderPathConfig from '../ProviderPathConfig.svelte';

  type Props = Omit<ComponentProps<typeof ProviderPathConfig>, 'open'>;

  let props: Props = $props();
  let open = $state(true);
</script>

<div class="relative">
  {#if open}
    <div class="absolute right-0 top-0">
      <ProviderPathConfig {...props} bind:open />
    </div>
  {/if}
</div>
