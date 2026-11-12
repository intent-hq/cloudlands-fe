<script lang="ts">
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import { Switch } from '$lib/components/patterns/settings/custom-controls';
  import { highlightTarget } from '$lib/components/patterns/settings/highlight-target';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectChatContentWidth,
    selectChatAuroraEnabled,
    selectCollapseToolRuns,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    setChatContentWidth,
    setChatAuroraEnabled,
    setCollapseToolRuns,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';

  const chatContentWidth = selectChatContentWidth();
  const chatAuroraEnabled = selectChatAuroraEnabled();
  const collapseToolRuns = selectCollapseToolRuns();
</script>

<section
  id="chat-content-width"
  data-highlight-id="chat-content-width"
  use:highlightTarget
  data-slot="settings-section-body"
  class="px-6 py-4"
>
  <SettingsFieldRow
    id="settings-appearance-chatContentWidth-label-field"
    label={m.settings_appearance_chatContentWidth_label()}
    description={m.settings_appearance_chatContentWidth_description()}
  >
    <Switch
      id="chat-content-width-switch"
      size="sm"
      class="mb-auto"
      checked={$chatContentWidth === 'full'}
      onCheckedChange={(enabled) =>
        appStore.dispatch(setChatContentWidth(enabled ? 'full' : '800'))}
      ariaLabel={m.settings_appearance_chatContentWidth_label()}
    />
  </SettingsFieldRow>
</section>
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
<section
  id="collapse-tool-runs"
  data-highlight-id="collapse-tool-runs"
  use:highlightTarget
  data-slot="settings-section-body"
  class="px-6 py-4"
>
  <SettingsFieldRow
    id="settings-appearance-collapseToolRuns-label-field"
    label={m.settings_appearance_collapseToolRuns_label()}
    description={m.settings_appearance_collapseToolRuns_description()}
  >
    <Switch
      id="collapse-tool-runs-switch"
      size="sm"
      class="mb-auto"
      checked={$collapseToolRuns}
      onCheckedChange={(enabled) => appStore.dispatch(setCollapseToolRuns(enabled))}
      ariaLabel={m.settings_appearance_collapseToolRuns_label()}
    />
  </SettingsFieldRow>
</section>
