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

  const remoteAgents$ = selectLabsRemoteAgentsEnabled();
  const sshMachineSetup$ = selectLabsSshMachineSetupEnabled();
  const plainFolders$ = selectLabsPlainFolderWorkspacesEnabled();
  const tabGroups$ = selectLabsTabGroupsEnabled();
  const desktop = isElectronPlatform();

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
          ],
        },
      ],
    }),
  );
</script>

<SettingsForm {schema} compact={false} />
