<script lang="ts">
  import { MINIMUM_NODE_VERSION } from '$shared/constants/auggie';
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';

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
      {m.lib_nodeVersionWarning_haveVersion_message({ minimumVersion: MINIMUM_NODE_VERSION, nodeVersion })}
    {:else}
      {m.lib_nodeVersionWarning_notFound_message({ minimumVersion: MINIMUM_NODE_VERSION })}
    {/if}
  </span>
</div>

