/** Source-renderer compatibility adapter for the shared terminal engine. */
import { TerminalEngine } from './TerminalEngine';
import type { TerminalCallbacks } from './terminal-engine-options';
import { Logger } from '../../shared/logger';
import { invoke as invokeIpc } from '../../shared/generated/ipc-client';
import { appClient as defaultAppClient } from '$lib/client';
import type { AppClient } from '$lib/client';
import { terminalHistoryTracker } from './terminal-history-tracker';
import { isGitHubUrl } from '$shared/utils/link-helpers';
import { dispatchWindowEvent } from '$lib/utils/window-events';
import { store as appStore } from '$store/renderer/store';
import {
  closeActiveTerminalRequested,
  toggleTerminalOverlay,
} from '$store/renderer/slices/terminals/terminals-slice';
import { selectCodeFontFamilyCSS } from '$store/renderer/slices/user-preferences/user-preferences-selectors';

export type { TerminalCallbacks, TerminalInfo } from './terminal-engine-options';

const logger = new Logger('TerminalAdapter');

export interface TerminalOptions extends TerminalCallbacks {
  workspaceId: string;
  terminalId?: string;
  container: HTMLElement;
  appClient?: Pick<AppClient, 'terminals'>;
  /** Initial preference; the component owns later updates through updateFontFamily. */
  fontFamily?: string;
}

export class TerminalAdapter extends TerminalEngine {
  constructor(options: TerminalOptions) {
    super({
      ...options,
      terminals: (options.appClient ?? defaultAppClient).terminals,
      fontFamily: options.fontFamily ?? selectCodeFontFamilyCSS.select(appStore.state),
      history: terminalHistoryTracker,
      onOpenLink: (uri) => this.openSourceLink(uri),
      onShortcut: (shortcut) => {
        switch (shortcut) {
          case 'toggle-overlay':
            appStore.dispatch(toggleTerminalOverlay(options.workspaceId));
            break;
          case 'new-terminal':
            dispatchWindowEvent('workspace:new-terminal', { workspaceId: options.workspaceId });
            break;
          case 'close-terminal':
            appStore.dispatch(closeActiveTerminalRequested(options.workspaceId));
            break;
        }
      },
    });
  }

  private openSourceLink(uri: string): void {
    try {
      // GitHub URLs always open in external browser
      if (isGitHubUrl(uri)) {
        logger.debug('GitHub URL detected in terminal, opening in external browser', {
          uri,
          workspaceId: this.getInfo().workspaceId,
        });
        void invokeIpc('shell:openExternal', { url: uri });
        return;
      }

      // Resolve loopback URLs, then open the browser panel on the result.
      void import('$lib/utils/browser-link-open')
        .then(({ resolveBrowserLinkForOpen }) => resolveBrowserLinkForOpen(uri))
        .catch((): { url: string; requestedUrl?: string } => ({ url: uri }))
        .then((resolved) => {
          import('$features/layout/panel-layout-adapter')
            .then(({ getPanelLayoutManager }) => {
              const layoutManager = getPanelLayoutManager(this.getInfo().workspaceId);
              layoutManager.openBrowserPanel(
                resolved.url,
                undefined,
                undefined,
                resolved.requestedUrl,
              );
              logger.debug('Opened URL in browser panel', {
                uri,
                resolvedUrl: resolved.url,
                workspaceId: this.getInfo().workspaceId,
              });
            })
            .catch((err) => {
              logger.warn('Failed to open URL in browser panel, falling back to external browser', {
                uri,
                error: err,
              });
              // Fallback to external browser
              void invokeIpc('shell:openExternal', { url: resolved.url });
            });
        });
    } catch (err) {
      logger.warn('Failed to handle link click', { uri, error: err });
      // Fallback to external browser
      void invokeIpc('shell:openExternal', { url: uri });
    }
  }
}
