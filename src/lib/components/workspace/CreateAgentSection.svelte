<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import SidebarHeaderAction from './sidebar/SidebarHeaderAction.svelte';

  interface Props {
    onCreate?: () => void;
    onCreateWithSpecialist?: (specialistId: string | null) => void;
    compact?: boolean;
  }

  let { onCreate, onCreateWithSpecialist, compact = false }: Props = $props();

  function handleCreateAgent() {
    if (onCreateWithSpecialist) {
      onCreateWithSpecialist(null);
    } else if (onCreate) {
      onCreate();
    }
  }
</script>

{#if compact}
  <SidebarHeaderAction
    icon="plus"
    label={m.workspace_createAgentSection_createNewAgent_label()}
    onclick={handleCreateAgent}
  />
{:else}
  <div class="w-full pb-2 -mt-1">
    <!-- Toggle Button -->
    <Button
      variant="ghost-light"
      size="xs"
      class="w-full px-0! justify-start gap-1.5 font-normal text-sm"
      onclick={handleCreateAgent}
    >
      <Fa icon={faPlus} size="xs" class="opacity-60 mr-1.25 ml-2.75" />
      {m.workspace_createAgentSection_createNewAgent_label()}
    </Button>
  </div>
{/if}
