<script lang="ts">
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';
  import { Switch } from '$lib/components/ui/switch';
  import { m } from '$shared/paraglide/messages.js';
  import { selectLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { setLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';

  const labsGitLabEnabled = selectLabsGitLabEnabled();
</script>

<section
  id="labs-gitlab"
  data-highlight-id="labs-gitlab"
  use:highlightTarget
  data-slot="settings-section-body"
  class="px-6 py-4"
>
  <SettingsFieldRow
    id="settings-labs-gitlab-label-field"
    label={m.settings_labs_gitlab_label()}
    description={m.settings_labs_gitlab_description()}
    experimental
  >
    <Switch
      id="labs-gitlab-switch"
      size="sm"
      class="mb-auto"
      checked={$labsGitLabEnabled}
      onCheckedChange={(enabled) => appStore.dispatch(setLabsGitLabEnabled(enabled))}
      ariaLabel={m.settings_labs_gitlab_label()}
    />
  </SettingsFieldRow>
</section>
