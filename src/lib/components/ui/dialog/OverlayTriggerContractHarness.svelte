<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Tooltip from '$lib/components/ui/tooltip';
</script>

{#snippet icon()}
  <span aria-hidden="true">+</span>
{/snippet}

{#snippet dialogTrigger({ props }: { props: Record<string, unknown> })}
  <Button {...props} leadingIcon={icon}>Dialog default trigger</Button>
{/snippet}

{#snippet tooltipTrigger({ props }: { props: Record<string, unknown> })}
  <Button {...props} leadingIcon={icon}>Tooltip default trigger</Button>
{/snippet}

<Dialog.Root>
  <Dialog.Trigger child={dialogTrigger} />
</Dialog.Root>

<Tooltip.Provider delayDuration={0}>
  <Tooltip.Root delayDuration={0}>
    <Tooltip.Trigger child={tooltipTrigger} />
  </Tooltip.Root>
</Tooltip.Provider>
