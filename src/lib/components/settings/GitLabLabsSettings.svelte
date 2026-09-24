<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { selectLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { setLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';

  const labsGitLabEnabled = selectLabsGitLabEnabled();
  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'labs-gitlab',
          title: m.settings_labs_gitlab_label(),
          entries: [
            {
              kind: 'switch',
              id: 'labs-gitlab-switch',
              size: 'sm',
              label: m.settings_labs_gitlab_label(),
              description: m.settings_labs_gitlab_description(),
              experimental: true,
              get: () => $labsGitLabEnabled,
              set: (enabled) => {
                appStore.dispatch(setLabsGitLabEnabled(enabled));
              },
            },
          ],
        },
      ],
    }),
  );
</script>

<SettingsForm {schema} embedded compact={false} />
