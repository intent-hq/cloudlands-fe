/**
 * File choosers in website popup windows under INTENT_IN_APP_PICKER=1.
 *
 * A popup a site opens (an allowed `window.open`) is its own BrowserWindow,
 * not a browser tab, so the browser CDP service never arms it. This attaches
 * the popup's debugger (popups have no other CDP user), intercepts its file
 * choosers and answers them with the in-app picker shown in the app renderer
 * behind the popup's opener (see picker-host.ts).
 */

import type { WebContents } from 'electron';

import {
  answerFileChooser,
  enableFileChooserInterception,
  type FileChooserCdp,
  type FileChooserOpenedParams,
  type PickFiles,
} from '../features/browser/main/browser-file-chooser';
import { Logger } from '../shared/logger';

const logger = new Logger('PopupFileChoosers');

const listening = new WeakSet<WebContents>();

type PickFor = (contents: WebContents, options: Parameters<PickFiles>[0]) => ReturnType<PickFiles>;

/** Arm `popup` (again after each load, since a navigation may reset the session). */
export function armPopupFileChooser(popup: WebContents, pickFor: PickFor): void {
  if (popup.isDestroyed()) return;
  const cdp: FileChooserCdp = {
    send: (method, params) => popup.debugger.sendCommand(method, params),
  };
  try {
    if (!popup.debugger.isAttached()) popup.debugger.attach('1.3');
  } catch (error) {
    logger.warn('Could not attach to a popup for file choosers', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (!listening.has(popup)) {
    listening.add(popup);
    popup.debugger.on('message', (_event, method, params, sessionId) => {
      if (sessionId || method !== 'Page.fileChooserOpened') return;
      void answerFileChooser(cdp, params as FileChooserOpenedParams, (options) =>
        pickFor(popup, options),
      ).catch((error: unknown) => {
        logger.warn('Popup file chooser failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }
  enableFileChooserInterception(cdp).catch((error: unknown) => {
    logger.warn('Could not intercept popup file choosers', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
