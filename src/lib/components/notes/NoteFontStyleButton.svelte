<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import {
  selectIsNoteMonospace,
  selectNoteFontStyleLabel,
} from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { cycleNoteFontStyle } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';


  const noteFontStyleLabel = selectNoteFontStyleLabel();
  const isNoteMonospace = selectIsNoteMonospace();

  function cycleFont() {
    appStore.dispatch(cycleNoteFontStyle());
  }
</script>

<Button
  variant="ghost-light"
  size="icon-xs"
  onclick={cycleFont}
  tooltip={`Font: ${$noteFontStyleLabel}`}
  tooltipSide="bottom"
>
  <span class="text-xs font-semibold tracking-tight" class:font-mono={$isNoteMonospace}> Aa </span>
</Button>
