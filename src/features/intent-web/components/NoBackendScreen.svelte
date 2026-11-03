<script lang="ts">
  /**
   * Shown instead of the app when the page host (intent-web) has no machine
   * bound to this tab yet: nothing local and nothing saved. Add machine opens
   * Settings → Machines, where the host saves the first one.
   */
  import { EmptyState } from '$lib/components/patterns/screen';
  import { Button } from '$lib/components/ui/button';
  import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
  import { m } from '$shared/paraglide/messages.js';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
</script>

<EmptyState class="h-full" emphasis="prominent" aria-labelledby="no-backend-title">
  {#snippet icon()}<DesktopIcon size={32} aria-hidden="true" />{/snippet}
  {#snippet title()}<h2 id="no-backend-title">{m.intentWeb_noBackend_title()}</h2>{/snippet}
  {#snippet description()}{m.intentWeb_noBackend_description()}{/snippet}
  {#snippet actions()}
    <Button onclick={() => void navigateToSettings({ tab: 'devices' })}>
      {m.intentWeb_noBackend_addMachine_label()}
    </Button>
  {/snippet}
</EmptyState>
