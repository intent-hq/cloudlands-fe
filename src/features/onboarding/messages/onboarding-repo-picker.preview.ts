import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import { store as appStore } from '$store/renderer/store';
import {
  localRepoDiscoveryFailed,
  localRepoDiscoveryStarted,
  localRepoDiscoverySucceeded,
  resetLocalRepoDiscovery,
  setRepos,
} from '$store/renderer/slices/known-repos/known-repos-slice';
import { selectKnownRepos } from '$store/renderer/slices/known-repos/known-repos-selectors';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
import { setWorkspaceInitializerLastSelectedRepo } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import { selectWorkspaceInitializerLastSelectedRepo } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
import ProjectPickerMessage from './ProjectPickerMessage.svelte';

let liveScenes = 0;

// UI-only named scenes: no application sagas, disk scans, or persisted app data.
// Saga wire behavior is covered independently in local-repo-discovery-saga.test.ts.
function setup(state: 'discovering' | 'discovered' | 'empty' | 'error') {
  return () => {
    if (liveScenes > 0) throw new Error('Open one onboarding picker preview state at a time.');
    liveScenes += 1;
    const previousRepos = selectKnownRepos.select(appStore.state);
    const previousWorkspaces = selectWorkspaceItems.select(appStore.state);
    const previousSelection = selectWorkspaceInitializerLastSelectedRepo.select(appStore.state);
    appStore.dispatch(setRepos([]));
    appStore.dispatch(replaceWorkspaceList([]));
    appStore.dispatch(setWorkspaceInitializerLastSelectedRepo(null));
    appStore.dispatch(localRepoDiscoveryStarted('local'));
    if (state === 'error') appStore.dispatch(localRepoDiscoveryFailed('local'));
    if (state === 'empty' || state === 'discovered') {
      appStore.dispatch(
        localRepoDiscoverySucceeded(
          'local',
          state === 'empty'
            ? []
            : [
                { path: '/Users/alex/Developer/website', name: 'website' },
                { path: '/Users/alex/Developer/design-system', name: 'design-system' },
                { path: '/Users/alex/Projects/weekend-app', name: 'weekend-app' },
              ],
        ),
      );
    }
    return () => {
      liveScenes -= 1;
      appStore.dispatch(resetLocalRepoDiscovery());
      appStore.dispatch(setRepos(previousRepos));
      appStore.dispatch(replaceWorkspaceList(previousWorkspaces));
      appStore.dispatch(setWorkspaceInitializerLastSelectedRepo(previousSelection));
    };
  };
}

export const preview = definePreview<ComponentProps<typeof ProjectPickerMessage>>({
  id: 'onboarding-repo-picker',
  title: 'Fresh-app repository picker',
  defaultState: 'discovered',
  states: {
    discovering: { props: {}, setup: setup('discovering') },
    discovered: { props: {}, setup: setup('discovered') },
    empty: { props: {}, setup: setup('empty') },
    error: { props: {}, setup: setup('error') },
  },
});

export default ProjectPickerMessage;
