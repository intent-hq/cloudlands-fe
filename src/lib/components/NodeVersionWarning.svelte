<script lang="ts">
  import { MINIMUM_NODE_VERSION } from '$shared/constants/auggie';
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    nodeVersion?: string;
    class?: string;
  }

  let { nodeVersion, class: className = '' }: Props = $props();
</script>

<div
  class="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-md text-amber-600 dark:text-amber-400 {className}"
>
  <Fa icon={faTriangleExclamation} class="w-4 h-4 flex-shrink-0" />
  <span class="text-xs">
    {#if nodeVersion}
      Node.js {MINIMUM_NODE_VERSION}+ is required to use Auggie. You have {nodeVersion} installed.
    {:else}
      Node.js {MINIMUM_NODE_VERSION}+ is required to use Auggie. Node.js was not found on your
      system.
    {/if}
  </span>
</div>

