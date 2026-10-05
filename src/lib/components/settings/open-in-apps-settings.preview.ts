import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import { store as appStore } from '$store/renderer/store';
import {
  selectEditorOrder,
  selectHiddenEditorIds,
  selectInstalledEditors,
  selectLastFetched,
} from '$store/renderer/slices/external-editors/external-editors-selectors';
import {
  fetchEditorsSuccess,
  setEditorOrder,
  setHiddenEditorIds,
  type InstalledEditor,
} from '$store/renderer/slices/external-editors/external-editors-slice';
import OpenInAppsSettings from './OpenInAppsSettings.svelte';

const previewEditor: InstalledEditor = {
  id: 'vscode',
  name: 'Visual Studio Code',
  shortLabel: 'VS Code',
  appName: 'Visual Studio Code',
  category: 'ide',
  handlerType: 'vscode',
  priority: 100,
  installed: true,
};

function setupInstalledEditor() {
  return () => {
    const previousEditors = selectInstalledEditors.select(appStore.state);
    const previousHiddenIds = selectHiddenEditorIds.select(appStore.state);
    const previousOrder = selectEditorOrder.select(appStore.state);
    const previousLastFetched = selectLastFetched.select(appStore.state);

    appStore.dispatch(fetchEditorsSuccess([previewEditor], 1));
    appStore.dispatch(setHiddenEditorIds([]));
    appStore.dispatch(setEditorOrder([previewEditor.id]));

    return () => {
      appStore.dispatch(fetchEditorsSuccess(previousEditors, previousLastFetched));
      appStore.dispatch(setHiddenEditorIds(previousHiddenIds));
      appStore.dispatch(setEditorOrder(previousOrder));
    };
  };
}

export const preview = definePreview<ComponentProps<typeof OpenInAppsSettings>>({
  id: 'open-in-apps-settings',
  title: 'Open In apps settings',
  defaultState: 'installed',
  states: {
    installed: { props: {}, setup: setupInstalledEditor() },
  },
});

export default OpenInAppsSettings;
