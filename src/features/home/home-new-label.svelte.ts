import { store } from '$store/renderer/store';
import { selectCanSetWorkspaceLabel } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
import { selectWorkspaceUpdateContext } from '$store/renderer/slices/workspace/workspace-selectors';

/** A pending "New label…" request from a Home workspace menu. */
export interface HomeNewLabelRequest {
  workspaceId: string;
  isCurrent: () => boolean;
  /** Expand the new label's Home list group (`label:<name>`). */
  expandGroup: (key: string) => void;
  getHomeElement: () => HTMLElement | null;
}

let request = $state<HomeNewLabelRequest | null>(null);

/** Opens the New label dialog hosted by `HomeNewLabelHost` beside the Home page. */
export const homeNewLabel = {
  get request(): HomeNewLabelRequest | null {
    return request;
  },
  open(next: Omit<HomeNewLabelRequest, 'isCurrent'>): void {
    const dispatch = store.dispatch;
    const context = selectWorkspaceUpdateContext.select(store.state, next.workspaceId, [
      'id',
      'label',
    ]);
    const isCurrent = () => {
      try {
        return (
          store.dispatch === dispatch &&
          context !== null &&
          selectCanSetWorkspaceLabel.select(store.state, next.workspaceId) &&
          context ===
            selectWorkspaceUpdateContext.select(store.state, next.workspaceId, ['id', 'label'])
        );
      } catch {
        return false;
      }
    };
    if (!isCurrent()) return;
    request = { ...next, isCurrent };
  },
  close(): void {
    request = null;
  },
};
