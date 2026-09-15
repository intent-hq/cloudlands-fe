<script lang="ts">
  import { Switch } from '$lib/components/ui/switch';
  import { m } from '$shared/paraglide/messages.js';
  import { selectReduceMotionOnBattery } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { setReduceMotionOnBattery } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';

  const reduceMotionOnBattery = selectReduceMotionOnBattery();
</script>

<div class="flex items-center justify-between">
  <div>
    <p class="text-sm font-medium text-foreground">
      {m.settings_appearance_reduceMotionOnBattery_label()}
    </p>
    <p class="text-xs text-subtle mt-1">
      {m.settings_appearance_reduceMotionOnBattery_description()}
    </p>
  </div>
  <Switch
    id="reduce-motion-on-battery-switch"
    size="sm"
    class="mb-auto"
    checked={$reduceMotionOnBattery}
    onCheckedChange={(enabled) => appStore.dispatch(setReduceMotionOnBattery(enabled))}
    ariaLabel={m.settings_appearance_reduceMotionOnBattery_label()}
  />
</div>
