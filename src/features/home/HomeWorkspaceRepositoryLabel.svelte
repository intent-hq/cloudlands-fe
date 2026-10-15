<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { Workspace } from '$shared/types';

  let {
    workspace,
    showOwner = true,
  }: {
    workspace: Pick<Workspace, 'repositoryOwner' | 'repositoryName' | 'repositoryPath'>;
    showOwner?: boolean;
  } = $props();

  const label = $derived(
    [showOwner ? workspace.repositoryOwner : undefined, workspace.repositoryName]
      .filter(Boolean)
      .join('/') || workspace.repositoryPath,
  );
</script>

{#if label}
  <Tooltip.Provider
    ><Tooltip.Root
      ><Tooltip.Trigger
        >{#snippet child({ props: homeTooltipProps })}<span
            {...homeTooltipProps}
            class="home-row-repository truncate type-caption text-muted-foreground"
            data-home-workspace-repository>{label}</span
          >{/snippet}</Tooltip.Trigger
      ><Tooltip.Content>{label}</Tooltip.Content></Tooltip.Root
    ></Tooltip.Provider
  >
{/if}
