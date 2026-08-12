import { IPC_CHANNELS } from '$shared/ipc-registry';

export type BrowserFocusInvoke = (
  channel: string,
  payload: { browserFocused: boolean; focusOwnerId: string },
) => Promise<unknown>;

export function createBrowserFocusOwnershipReporter(
  invoke: BrowserFocusInvoke,
  createOwnerId: () => string = () => crypto.randomUUID(),
) {
  let browserIdentity: string | null = null;
  let focusOwnerId: string | null = null;

  function report(browserFocused: boolean, ownerId: string) {
    void invoke(IPC_CHANNELS.WINDOW.SET_BROWSER_FOCUSED, {
      browserFocused,
      focusOwnerId: ownerId,
    }).catch(() => {
      // Main-process focus tracking is best-effort during startup and teardown.
    });
  }

  function release() {
    if (focusOwnerId) report(false, focusOwnerId);
    focusOwnerId = null;
    browserIdentity = null;
  }

  return {
    update(nextBrowserIdentity: string | null) {
      if (nextBrowserIdentity === browserIdentity) return;
      release();
      if (!nextBrowserIdentity) return;

      browserIdentity = nextBrowserIdentity;
      focusOwnerId = createOwnerId();
      report(true, focusOwnerId);
    },
    destroy: release,
  };
}
