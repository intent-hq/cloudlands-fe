<script lang="ts">
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import { Switch } from '$lib/components/patterns/settings/custom-controls';
  import { highlightTarget } from '$lib/components/patterns/settings/highlight-target';
  import { m } from '$shared/paraglide/messages.js';
  import { selectChatAuroraEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { setChatAuroraEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';

  const chatAuroraEnabled = selectChatAuroraEnabled();
</script>

<section
  id="chat-aurora"
  data-highlight-id="chat-aurora"
  use:highlightTarget
  data-slot="settings-section-body"
  class="px-6 py-4"
>
  <SettingsFieldRow
    id="settings-appearance-chatAurora-label-field"
    label={m.settings_appearance_chatAurora_label()}
    description={m.settings_appearance_chatAurora_description()}
  >
    <Switch
      id="chat-aurora-switch"
      size="sm"
      class="mb-auto"
      checked={$chatAuroraEnabled}
      onCheckedChange={(enabled) => appStore.dispatch(setChatAuroraEnabled(enabled))}
      ariaLabel={m.settings_appearance_chatAurora_label()}
    />
  </SettingsFieldRow>
</section>
