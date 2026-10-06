import { getHardwareConsoleManager } from '$features/hardware-console/instance';
import { store as appStore } from '$store/renderer/store';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
import { hydrateHardwareConsoleKeyPins } from '$store/renderer/slices/hardware-console/hardware-console-slice';
import {
  selectHardwareConsoleKeyPins,
  selectHardwareConsoleExcludedWorkspaceIds,
} from '$store/renderer/slices/hardware-console/hardware-console-selectors';
import type { Workspace } from '$shared/types';

/** Fixture-only connection status; never starts or opens a hardware device. */
export function setupSidebarKeySlots(workspaces: Workspace[]) {
  const manager = getHardwareConsoleManager();
  const statusDescriptor = Object.getOwnPropertyDescriptor(manager, 'status');
  const previousWorkspaces = selectWorkspaceItems.select(appStore.state);
  const previousPins = selectHardwareConsoleKeyPins.select(appStore.state);
  const previousExcluded = selectHardwareConsoleExcludedWorkspaceIds.select(appStore.state);
  Object.defineProperty(manager, 'status', { configurable: true, get: () => 'connected' });
  appStore.dispatch(replaceWorkspaceList(workspaces));
  appStore.dispatch(
    hydrateHardwareConsoleKeyPins(
      [workspaces[0].id, null, null, null, null, null],
      workspaces.slice(1).map(({ id }) => id),
    ),
  );
  return () => {
    appStore.dispatch(replaceWorkspaceList(previousWorkspaces));
    appStore.dispatch(hydrateHardwareConsoleKeyPins(previousPins, previousExcluded));
    if (statusDescriptor) Object.defineProperty(manager, 'status', statusDescriptor);
    else Reflect.deleteProperty(manager, 'status');
  };
}
