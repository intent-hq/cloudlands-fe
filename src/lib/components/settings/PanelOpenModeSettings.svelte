<script lang="ts">
  import { selectPanelColumnCount } from '$store/renderer/slices/user-preferences/user-preferences-selectors';

  const panelColumnCount$ = selectPanelColumnCount();
</script>

<div class="hidden" data-panel-column-count={$panelColumnCount$}></div>
