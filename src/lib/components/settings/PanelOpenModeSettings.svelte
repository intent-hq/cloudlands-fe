<script lang="ts">
  import { Toggle } from '$lib/components/ui/toggle';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectPanelOpenMode,
    selectPanelStackDirection,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    togglePanelOpenMode,
    togglePanelStackDirection,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';

  const panelOpenMode$ = selectPanelOpenMode();
  const panelStackDirection$ = selectPanelStackDirection();

  function handleChange() {
    appStore.dispatch(togglePanelOpenMode());
  }

  function handleStackDirectionChange() {
    appStore.dispatch(togglePanelStackDirection());
  }
</script>

<div class="flex flex-col gap-5">
  <div class="flex items-center justify-between gap-6">
    <div>
      <p class="text-sm font-medium text-foreground">
        {m.settings_panels_openNewPinned_label()}
      </p>
      <p class="mt-0.5 text-xs text-subtle">
        {m.settings_panels_openNewPinned_description()}
      </p>
    </div>
    <Toggle
      pressed={$panelOpenMode$ === 'pin'}
      onChange={handleChange}
      variant="indicator"
      size="xs"
      class="mb-auto"
      ariaLabel={m.settings_panels_openNewPinned_label()}
      onLabel={m.settings_panels_openNewPinned_on_label()}
      offLabel={m.settings_panels_openNewPinned_off_label()}
    />
  </div>
  <div class="flex items-center justify-between gap-6 border-t border-border pt-5">
    <div>
      <p class="text-sm font-medium text-foreground">
        {m.settings_panels_stackDirection_label()}
      </p>
      <p class="mt-0.5 text-xs text-subtle">
        {m.settings_panels_stackDirection_description()}
      </p>
    </div>
    <Toggle
      pressed={$panelStackDirection$ === 'right'}
      onChange={handleStackDirectionChange}
      variant="indicator"
      size="xs"
      class="mb-auto"
      ariaLabel={m.settings_panels_stackDirection_label()}
      onLabel={m.settings_panels_stackDirection_right_label()}
      offLabel={m.settings_panels_stackDirection_left_label()}
    />
  </div>
</div>
