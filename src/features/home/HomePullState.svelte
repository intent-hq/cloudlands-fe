<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Fa from 'svelte-fa';
  import { faCodePullRequest, faCodeMerge, faHourglassHalf } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  let { state, compact = false }: { state?: string; compact?: boolean } = $props();
  const appearance = $derived(
    state === 'merged'
      ? {
          icon: faCodeMerge,
          color: 'text-primary',
          label: m.ui_linkTooltip_gitHubStateMerged_label(),
        }
      : state === 'closed'
        ? {
            icon: faCodePullRequest,
            color: 'text-danger',
            label: m.ui_linkTooltip_gitHubStateClosed_label(),
          }
        : state === 'draft'
          ? {
              icon: faCodePullRequest,
              color: 'text-muted-foreground',
              label: m.ui_linkTooltip_gitHubStateDraft_label(),
            }
          : state === 'queued'
            ? {
                icon: faHourglassHalf,
                color: 'text-info',
                label: m.ui_linkTooltip_gitHubStateQueued_label(),
              }
            : {
                icon: faCodePullRequest,
                color: 'text-success',
                label: m.ui_linkTooltip_gitHubStateOpen_label(),
              },
  );
</script>

<Tooltip.Provider
  ><Tooltip.Root
    ><Tooltip.Trigger
      >{#snippet child({ props: homeTooltipProps })}<span
          {...homeTooltipProps}
          class="inline-flex items-center gap-1.5 type-caption {appearance.color}"
        >
          <Fa icon={appearance.icon} />
          <span class:sr-only={compact}>{appearance.label}</span>
        </span>{/snippet}</Tooltip.Trigger
    ><Tooltip.Content>{appearance.label}</Tooltip.Content></Tooltip.Root
  ></Tooltip.Provider
>
