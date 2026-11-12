<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { dockLabEnabled, setDockLabEnabled } from '$lib/dock-lab';
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import { store as appStore } from '$store/renderer/store';
  import { setBrowserAccessEnabledRequested } from '$store/renderer/slices/browser-access/browser-access-slice';
  import { setMachineRailEnabledRequested } from '$store/renderer/slices/machine-rail/machine-rail-slice';
  import { selectMachineRailEnabled } from '$store/renderer/slices/machine-rail/machine-rail-selectors';
  import {
    setLabsBrowserAccessEnabled,
    setLabsPlainFolderWorkspacesEnabled,
    setLabsRemoteAgentsEnabled,
    setLabsSshMachineSetupEnabled,
    setLabsTabGroupsEnabled,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    selectLabsBrowserAccessEnabled,
    selectLabsPlainFolderWorkspacesEnabled,
    selectLabsRemoteAgentsEnabled,
    selectLabsSshMachineSetupEnabled,
    selectLabsTabGroupsEnabled,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';

  const remoteAgents$ = selectLabsRemoteAgentsEnabled();
  const sshMachineSetup$ = selectLabsSshMachineSetupEnabled();
  const plainFolders$ = selectLabsPlainFolderWorkspacesEnabled();
  const tabGroups$ = selectLabsTabGroupsEnabled();
  const browserAccess$ = selectLabsBrowserAccessEnabled();
  const machineRail$ = selectMachineRailEnabled();
  const desktop = isElectronPlatform();

  function setBrowserAccess(enabled: boolean) {
    appStore.dispatch(setLabsBrowserAccessEnabled(enabled));
    // Hiding the section must not leave a server running that nobody can see.
    if (!enabled) appStore.dispatch(setBrowserAccessEnabledRequested(false));
  }

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
              id: 'labs-browser-access',
              size: 'sm',
              label: m.settings_labs_browserAccess_label(),
              description: m.settings_labs_browserAccess_description(),
              get: () => $browserAccess$,
              set: setBrowserAccess,
            },
            {
              kind: 'switch',
              id: 'labs-machine-rail',
              size: 'sm',
              label: m.settings_labs_machineRail_label(),
              description: m.settings_labs_machineRail_description(),
              when: () => desktop,
              get: () => $machineRail$,
              set: (enabled) => {
                appStore.dispatch(setMachineRailEnabledRequested(enabled));
              },
            },
            {
              kind: 'switch',
              id: 'labs-dock',
              size: 'sm',
              label: m.settings_dockLab_label(),
              description: m.settings_dockLab_description(),
              when: () => desktop,
              get: () => $dockLabEnabled,
              set: setDockLabEnabled,
            },
          ],
        },
      ],
    }),
  );
</script>

<SettingsForm {schema} compact={false} />
