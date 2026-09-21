<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import ArrowClockwise from 'phosphor-svelte/lib/ArrowClockwiseIcon';
  import { m } from '$shared/paraglide/messages.js';

  let { disabled, onclick }: { disabled: boolean; onclick: () => void } = $props();
</script>

<Button
  iconOnly
  variant="plain"
  size="icon-compact"
  class="expanded-card-action rounded-md text-foreground hover:bg-muted/50 focus-visible:bg-muted"
  {onclick}
  {disabled}
  aria-busy={disabled}
  aria-label={m.workspace_sidebarChanges_refreshGitStatus_tooltip()}
  tooltip={m.workspace_sidebarChanges_refreshGitStatus_tooltip()}
  title={m.workspace_sidebarChanges_refreshGitStatus_tooltip()}
  tooltipSide="top"
  tooltipDelayDuration={300}
  data-changes-refresh
>
  <ArrowClockwise size={14} weight="regular" />
</Button>
