import { createChannelFromSelector } from '@themislib/themis/saga';
import { take, type SagaGenerator } from 'typed-redux-saga';
import {
  selectDesktopFileIdentity,
  selectDesktopFileViewIdentity,
} from '../desktop-file-selectors';

export function* waitForDesktopFileAuthorityRetirement(
  workspaceId: string,
  path: string,
): SagaGenerator<void> {
  const identity = yield* selectDesktopFileIdentity.effect(workspaceId, path);
  const channel = yield* createChannelFromSelector(selectDesktopFileIdentity, workspaceId, path);
  try {
    if (!identity) return;
    while ((yield* take(channel)).payload === identity) {
      /* first different identity permanently retires */
    }
  } finally {
    channel.close();
  }
}

/** DOM callback lifetime only; canonical content and transport remain in their existing owners. */
export function* observeDesktopFileViewRetirement(
  workspaceId: string,
  path: string,
  panelId: string,
  tabId: string,
  retire: () => void,
): SagaGenerator<void> {
  const identity = yield* selectDesktopFileViewIdentity.effect(workspaceId, path, panelId, tabId);
  const channel = yield* createChannelFromSelector(
    selectDesktopFileViewIdentity,
    workspaceId,
    path,
    panelId,
    tabId,
  );
  try {
    if (identity)
      while ((yield* take(channel)).payload === identity) {
        /* no re-adoption after ABA */
      }
    retire();
  } finally {
    channel.close();
  }
}
