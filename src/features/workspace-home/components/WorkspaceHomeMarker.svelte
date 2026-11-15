<script lang="ts">
  /**
   * The marker on a workspace's card or row while its home is detached or
   * moving (PROTOCOL `methods/nodes.md` → "Detached workspaces"). Its tooltip
   * gives the same reason as the banner. Nothing without a home.
   */
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Badge } from '$lib/components/ui/badge';
  import type { Workspace } from '$shared/types';
  import { workspaceHomeView } from '../workspace-home';
  import { homeMarkerLabel, homeUnavailableText } from '../workspace-home-copy';

  let { workspace }: { workspace: Pick<Workspace, 'home'> } = $props();

  const view = $derived(workspaceHomeView(workspace));
  const marker = $derived(view?.marker ?? null);
</script>

{#if view && marker}
  <Tooltip.Provider
    ><Tooltip.Root
      ><Tooltip.Trigger
        >{#snippet child({ props: markerTooltipProps })}<Badge
            {...markerTooltipProps}
            variant="dot"
            color={marker === 'detached' ? 'amber' : 'blue'}
            size="compact"
            data-workspace-home-marker={marker}
            >{homeMarkerLabel(marker)}<span class="sr-only">{homeUnavailableText(view)}</span
            ></Badge
          >{/snippet}</Tooltip.Trigger
      ><Tooltip.Content>{homeUnavailableText(view)}</Tooltip.Content></Tooltip.Root
    ></Tooltip.Provider
  >
{/if}
