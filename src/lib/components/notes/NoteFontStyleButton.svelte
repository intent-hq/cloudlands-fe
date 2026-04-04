<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import {
    selectIsNoteMonospace,
    selectNoteFontStyleLabel,
  } from '$lib/store/slices/user-preferences/user-preferences-selectors';
  import { cycleNoteFontStyle } from '$lib/store/slices/user-preferences/user-preferences-slice';
  import { getDispatch } from '$lib/store/utils/utils';

  const dispatch = getDispatch();
  const noteFontStyleLabel = selectNoteFontStyleLabel();
  const isNoteMonospace = selectIsNoteMonospace();

  function cycleFont() {
    dispatch(cycleNoteFontStyle());
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
