<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Badge } from '$lib/components/ui/badge';
  import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';

  let { workspace }: { workspace: Pick<Workspace, 'status'> } = $props();
</script>

<!-- A Retired workspace (PROTOCOL §5.1) is archived with its folder purged. -->
{#if workspace.status === WorkspaceStatusEnum.Retired}
  <Tooltip.Provider
    ><Tooltip.Root
      ><Tooltip.Trigger
        >{#snippet child({ props: homeTooltipProps })}<Badge
            {...homeTooltipProps}
            size="compact"
            class="text-muted-foreground"
            data-home-workspace-purged>{m.workspace_purged_badge_label()}</Badge
          >{/snippet}</Tooltip.Trigger
      ><Tooltip.Content>{m.workspace_purged_badge_tooltip()}</Tooltip.Content></Tooltip.Root
    ></Tooltip.Provider
  >
{/if}
