<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Popover from '$lib/components/ui/popover';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faSliders } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  let { children }: { children: Snippet } = $props();
</script>

<Popover.Root>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="icon-sm"
        class="shrink-0 rounded-full bg-muted/50"
        aria-label={m.home_view_options()}
        title={m.home_view_options()}
      >
        <Fa icon={faSliders} />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content align="end" class="w-72 p-3">
    <div class="flex flex-col gap-3">
      <span class="type-caption font-medium">{m.home_view_options()}</span>
      {@render children()}
    </div>
  </Popover.Content>
</Popover.Root>
