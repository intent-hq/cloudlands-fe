<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import AuggieAvatar from '$features/agent/components/auggie-avatar/AuggieAvatar.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import {
    selectOnboardingActive,
    selectPanelItem,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { togglePanel } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { store as appStore } from '$store/renderer/store';

  const panelItem$ = selectPanelItem();
  const onboardingActive$ = selectOnboardingActive();
  const isActive = $derived($panelItem$ === 'chief');
</script>

{#if !$onboardingActive$}
  <Tooltip content="Chief of Staff" side="bottom" delayDuration={300}>
    <button
      type="button"
      class="flex size-7 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground"
      onclick={() => appStore.dispatch(togglePanel('chief'))}
      aria-label={m.layout_chiefTrigger_toggle_ariaLabel()}
      aria-expanded={isActive}
      data-chief-trigger
    >
      <AuggieAvatar size={20} />
    </button>
  </Tooltip>
{/if}
