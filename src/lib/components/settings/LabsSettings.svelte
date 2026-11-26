<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import { store as appStore } from '$store/renderer/store';
  import {
    setLabsPlainFolderWorkspacesEnabled,
    setLabsRemoteAgentsEnabled,
    setLabsSshMachineSetupEnabled,
    setLabsTabGroupsEnabled,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    selectLabsPlainFolderWorkspacesEnabled,
    selectLabsRemoteAgentsEnabled,
    selectLabsSshMachineSetupEnabled,
    selectLabsTabGroupsEnabled,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { browserViewsLab } from '$lib/components/browser/main-owned-browser-page';
  import { setBrowserViewsLabRequested } from '$store/renderer/slices/browser-views-lab/browser-views-lab-slice';
  import { selectIntentAppsLabEnabled } from '$store/renderer/slices/intent-apps/intent-apps-selectors';
  import { intentAppsLabRequested } from '$store/renderer/slices/intent-apps/intent-apps-slice';

  const remoteAgents$ = selectLabsRemoteAgentsEnabled();
  const sshMachineSetup$ = selectLabsSshMachineSetupEnabled();
  const plainFolders$ = selectLabsPlainFolderWorkspacesEnabled();
  const tabGroups$ = selectLabsTabGroupsEnabled();
  const desktop = isElectronPlatform();
  const browserPagesLab$ = browserViewsLab;
  const intentAppsLab$ = selectIntentAppsLabEnabled();

  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'labs',
          title: m.settings_labs_title_label(),
          description: m.settings_labs_disclaimer_description(),
          entries: [
            {
              kind: 'switch',
              id: 'labs-remote-agents',
              size: 'sm',
              label: m.settings_labs_remoteAgents_label(),
              description: m.settings_labs_remoteAgents_description(),
              get: () => $remoteAgents$,
              set: (enabled) => {
                appStore.dispatch(setLabsRemoteAgentsEnabled(enabled));
              },
            },
            {
              kind: 'switch',
              id: 'labs-ssh-machine-setup',
              size: 'sm',
              label: m.settings_labs_sshMachineSetup_label(),
              description: m.settings_labs_sshMachineSetup_description(),
              when: () => desktop,
              get: () => $sshMachineSetup$,
              set: (enabled) => {
                appStore.dispatch(setLabsSshMachineSetupEnabled(enabled));
              },
            },
            {
              kind: 'switch',
              id: 'labs-plain-folders',
              size: 'sm',
              label: m.settings_labs_plainFolders_label(),
              description: m.settings_labs_plainFolders_description(),
              get: () => $plainFolders$,
              set: (enabled) => {
                appStore.dispatch(setLabsPlainFolderWorkspacesEnabled(enabled));
              },
            },
            {
              kind: 'switch',
              id: 'labs-tab-groups',
              size: 'sm',
              label: m.settings_labs_tabGroups_label(),
              description: m.settings_labs_tabGroups_description(),
              get: () => $tabGroups$,
              set: (enabled) => {
                appStore.dispatch(setLabsTabGroupsEnabled(enabled));
              },
            },
            {
              kind: 'switch',
              id: 'labs-browser-pages-in-main',
              size: 'sm',
              label: m.settings_labs_browserPagesInMain_label(),
              description: m.settings_labs_browserPagesInMain_description(),
              when: () => desktop,
              get: () => $browserPagesLab$.enabled,
              set: (enabled) => {
                appStore.dispatch(setBrowserViewsLabRequested(enabled));
              },
            },
            {
              kind: 'switch',
              id: 'labs-intent-apps',
              size: 'sm',
              label: m.settings_labs_intentApps_label(),
              description: m.settings_labs_intentApps_description(),
              when: () => desktop,
              get: () => $intentAppsLab$,
              set: (enabled) => {
                appStore.dispatch(intentAppsLabRequested(enabled));
              },
            },
          ],
        },
      ],
    }),
  );
</script>

<SettingsForm {schema} compact={false} />
