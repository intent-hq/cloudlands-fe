<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { navigateToNewWorkspace } from '$features/new-workspace/route/new-workspace-navigation';
</script>

<svelte:head>
  <title>{m.home_page_title()}</title>
</svelte:head>

<div class="flex h-full flex-col items-center justify-center gap-1.5 text-center">
  <p class="text-lg font-medium text-foreground">{m.home_emptyState_noSpaceSelected_label()}</p>
  <p class="text-sm text-subtle">{m.home_emptyState_selectOrCreate_description()}</p>
  <Button class="mt-3" onclick={() => void navigateToNewWorkspace()}>
    {m.home_emptyState_newSpace_label()}
  </Button>
</div>
