import { createChannelFromSelector } from '@themislib/themis/saga';
import { put, take, type SagaGenerator } from 'typed-redux-saga';
import { selectDesktopFileExplorerLifetime } from '../file-explorer-selectors';
import { retireFileExplorer } from '../../../../../../src/store/renderer/slices/file-explorer/file-explorer-slice';

/**
 * Sticky callback retirement observes every Redux transition, including A→B→A before render.
 * Parking revokes callbacks but retains the tree; a resource change also retires pending reads.
 */
export function* observeDesktopFileTreeRetirement(
  workspaceId: string,
  capturedContext: string,
  retire: () => void,
): SagaGenerator<void> {
  const captured = yield* selectDesktopFileExplorerLifetime.effect(workspaceId);
  const channel = yield* createChannelFromSelector(selectDesktopFileExplorerLifetime, workspaceId);
  let viewRetired = false;
  let wasActive = captured.active;
  let wasMounted = captured.mounted;
  try {
    while (true) {
      const { payload: current } = yield* take(channel);
      wasActive ||= current.active;
      wasMounted ||= current.mounted;
      const resourceRetired =
        current.context !== capturedContext ||
        current.membership !== captured.membership ||
        (wasMounted && !current.mounted);
      if (!viewRetired && (resourceRetired || (wasActive && !current.active))) {
        viewRetired = true;
        retire();
      }
      if (resourceRetired) {
        yield* put(retireFileExplorer(workspaceId));
        return;
      }
    }
  } finally {
    channel.close();
  }
}
