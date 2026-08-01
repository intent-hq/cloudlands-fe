<script lang="ts">
  /**
   * Chrome-less HUD window main content: no WindowTitleBar, no sidebar
   * rail/panel, no rounded main chrome — the HUD header is the only top
   * chrome and carries the macOS drag region.
   */
  import type { Snippet } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';

  let { resolvedLocale, children }: { resolvedLocale: string; children?: Snippet } = $props();
</script>

<main
  class="flex flex-1 min-h-0 flex-col overflow-hidden"
  aria-label={m.layout_appShell_mainContent_ariaLabel()}
>
  <div class="flex-1 min-h-0 overflow-auto">
    {#key resolvedLocale}{@render children?.()}{/key}
  </div>
</main>
