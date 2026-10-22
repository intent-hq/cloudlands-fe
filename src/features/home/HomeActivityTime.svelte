<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import type { Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { homeActivity } from './home-activity';
  let { workspace }: { workspace: Workspace } = $props();
  const activity = $derived(homeActivity(workspace));
  const label = $derived(
    activity.source === 'content'
      ? m.home_activity_content()
      : activity.source === 'created'
        ? m.home_activity_created()
        : m.home_activity_unknown(),
  );
</script>

<Tooltip.Provider
  ><Tooltip.Root
    ><Tooltip.Trigger
      >{#snippet child({ props: homeTooltipProps })}<span {...homeTooltipProps} aria-label={label}>
          {#if activity.time > 0}<RelativeTime date={activity.time} compact />{:else}<span
              aria-hidden="true">—</span
            >{/if}
        </span>{/snippet}</Tooltip.Trigger
    ><Tooltip.Content>{label}</Tooltip.Content></Tooltip.Root
  ></Tooltip.Provider
>
