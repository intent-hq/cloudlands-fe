<script lang="ts">
  /**
   * Settings Tab Type Component
   *
   * Placeholder for settings panel - not yet implemented.
   */

  import type { TabTypeComponentProps } from './registry';
  import { m } from '$shared/paraglide/messages.js';

  let { tab }: TabTypeComponentProps = $props();
</script>

<div class="flex flex-col items-center justify-center h-full text-subtle gap-4">
  <div class="text-center">
    <p class="text-lg font-medium text-foreground">{tab.title}</p>
    <p class="text-sm">{m.layout_panelContent_typeLabel({ type: tab.type })}</p>
    <p class="text-xs mt-4 text-subtle">{m.layout_settingsTab_notImplemented_label()}</p>
  </div>
</div>
