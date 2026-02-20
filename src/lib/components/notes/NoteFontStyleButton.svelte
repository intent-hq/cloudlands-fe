<script lang="ts">
  import {
    noteFontSettings,
    type NoteFontStyle,
  } from '$lib/stores/note-font-settings.store.svelte';
  import { Button } from '$lib/components/ui/button';

  // Font styles to cycle through
  const fontStyles: NoteFontStyle[] = ['sans', 'monospace'];

  // Get label for current style
  const currentLabel = $derived(
    noteFontSettings.fontStyle === 'monospace' ? 'Monospace' : 'Sans-serif',
  );

  function cycleFont() {
    const currentIndex = fontStyles.indexOf(noteFontSettings.fontStyle);
    const nextIndex = (currentIndex + 1) % fontStyles.length;
    noteFontSettings.fontStyle = fontStyles[nextIndex];
  }
</script>

<Button
  variant="ghost-light"
  size="icon-xs"
  onclick={cycleFont}
  tooltip={`Font: ${currentLabel}`}
  tooltipSide="bottom"
>
  <span
    class="text-xs font-semibold tracking-tight"
    class:font-mono={noteFontSettings.fontStyle === 'monospace'}
  >
    Aa
  </span>
</Button>
