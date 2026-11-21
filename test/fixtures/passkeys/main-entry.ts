/**
 * The main-process code under test, in one bundle so the guest IPC guard,
 * PasskeyService and BrowserViewService share one page-owner seam
 * (`src/main/browser-panel-pages.ts`), as they do in the app.
 */
export { installIpcHandleAuthorization } from '../../../src/main/ipc-authorization';
export { setupPasskeysIPC } from '../../../src/features/passkeys/main/passkeys.ipc';
export { BrowserViewService } from '../../../src/features/browser/main/browser-view-service';
export {
  notifyMainOwnedBrowserPageMoved,
  setMainOwnedBrowserPageOwners,
} from '../../../src/main/browser-panel-pages';
