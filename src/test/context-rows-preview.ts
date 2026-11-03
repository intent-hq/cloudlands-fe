import { store } from '$store/renderer/store';
import { sidebarNavSaga } from '$store/renderer/slices/sidebar-nav/sagas/sidebar-nav-saga';
import { workspaceMounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

export function setupContextRowsPreview(workspaceId: string) {
  const stop = store.runSaga(sidebarNavSaga);
  let disposed = false;
  queueMicrotask(() => {
    if (!disposed) store.dispatch(workspaceMounted(workspaceId));
  });
  return () => {
    disposed = true;
    stop();
  };
}
