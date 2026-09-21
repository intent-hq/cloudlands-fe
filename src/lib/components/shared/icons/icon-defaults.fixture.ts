import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '$store/renderer/store';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { fetchEditorsSuccess } from '$store/renderer/slices/external-editors/external-editors-slice';

export function initializeIconPreview() {
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  const previous = store.state.externalEditors;
  store.dispatch(
    fetchEditorsSuccess(
      [
        {
          id: 'vscode',
          name: 'Visual Studio Code', // i18n-ignore (brand name)
          shortLabel: 'VS Code',
          appName: 'Visual Studio Code', // i18n-ignore (OS application brand name)
          category: 'ide',
          handlerType: 'vscode',
          installed: true,
          priority: 100,
        },
        {
          id: 'finder',
          name: 'Finder',
          shortLabel: 'Finder',
          appName: 'Finder',
          category: 'finder',
          handlerType: 'finder',
          installed: true,
          priority: 0,
        },
      ],
      Date.now(),
    ),
  );
  return () => {
    store.dispatch(fetchEditorsSuccess(getItems(previous.editors), previous.lastFetched));
    dispose();
  };
}
