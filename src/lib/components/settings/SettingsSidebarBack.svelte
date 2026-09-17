<script lang="ts">
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { ListRow } from '$lib/components/patterns/collection';
  import { m } from '$shared/paraglide/messages.js';
  import { isMacPlatform } from '$lib/utils/shortcuts';
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';

  let { onBack }: { onBack: () => void } = $props();
  const isMac = isMacPlatform();
</script>

<div class="shrink-0 px-3 pt-5 pb-5" data-settings-sidebar-back>
  <Button
    variant="plain"
    type="button"
    onclick={onBack}
    class="h-auto w-full justify-start rounded-lg p-0 text-left type-caption font-normal text-muted-foreground hover:bg-hover active:bg-active"
  >
    <ListRow class="min-h-8 w-full gap-2 px-3 py-0">
      {#snippet leading()}
        <span class="flex size-4 shrink-0 items-center justify-center">
          <ArrowLeftIcon size={16} weight="regular" />
        </span>
      {/snippet}
      {#snippet title()}
        <span
          data-settings-sidebar-label
          class="block truncate type-body font-normal text-muted-foreground"
        >
          {m.settings_sidebar_backToApp_label()}
        </span>
      {/snippet}
      {#snippet trailing()}
        <kbd class="type-caption font-normal text-muted-foreground">
          {isMac ? '⌘' : 'Ctrl'},
        </kbd>
      {/snippet}
    </ListRow>
  </Button>
</div>
