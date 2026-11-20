/**
 * Browser-panel passkeys (Linux, opt-in while unfinished: `INTENT_BROWSER_PASSKEYS=1`). Registers the WebAuthn frame preload on the
 * `persist:browser-panel` session and the IPC handlers that run ceremonies
 * through the bundled `intent-passkey` helper. Without the helper (other
 * platforms, or a build that does not bundle it) nothing is registered and
 * the browser panel keeps Electron's own WebAuthn behaviour.
 *
 * Helper location (it ships inside the Linux intentd release archive as
 * libexec/intent-passkey; scripts/fetch-sidecar.cjs stages it next to intentd):
 *   - `INTENT_PASSKEY_BIN=/path/to/intent-passkey` (dev and tests)
 *   - Packaged: `process.resourcesPath/intentd/intent-passkey`
 *   - Dev: `resources/sidecar/intent-passkey`
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, ipcMain, session } from 'electron';
import { BROWSER_PANEL_PARTITION } from '../../../shared/constants';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { Logger } from '../../../shared/logger';
import { PasskeySidecar } from './passkey-sidecar';
import { PasskeyService } from './passkey-service';

const logger = new Logger('Passkeys');
const CHANNELS = IPC_CHANNELS.PASSKEYS;
const BINARY_NAME = 'intent-passkey';

function resolvePasskeyBinaryPath(
  env: NodeJS.ProcessEnv = process.env,
  resourcesPath: string | undefined = process.resourcesPath,
  appPath: string = app.getAppPath(),
): string | null {
  const override = env.INTENT_PASSKEY_BIN?.trim();
  const candidates = override
    ? [override]
    : [
        ...(resourcesPath ? [path.join(resourcesPath, 'intentd', BINARY_NAME)] : []),
        path.join(appPath, 'resources', 'sidecar', BINARY_NAME),
      ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

let service: PasskeyService | null = null;

/** True once the passkey frame preload is registered on the browser-panel session. */
export function arePasskeysEnabled(): boolean {
  return service !== null;
}

/** `preloadPath` lets the isolated Electron test load the compiled preload from its bundle. */
export function setupPasskeysIPC(
  preloadPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../preload-build/preload/passkey-page.js',
  ),
): void {
  if (process.platform !== 'linux' || service) return;
  if (process.env.INTENT_BROWSER_PASSKEYS !== '1') return;
  const binary = resolvePasskeyBinaryPath();
  if (!binary) {
    logger.info('intent-passkey is not bundled; the browser panel keeps native WebAuthn');
    return;
  }
  const browserSession = () => session.fromPartition(BROWSER_PANEL_PARTITION);
  const active = new PasskeyService(new PasskeySidecar(binary), browserSession);
  service = active;
  browserSession().registerPreloadScript({
    id: 'intent-passkeys',
    type: 'frame',
    filePath: preloadPath,
    // Secure contexts only; main checks the frame origin again on every call.
    matches: ['https://*/*', 'http://localhost/*', 'http://*.localhost/*', 'http://127.0.0.1/*'],
  });
  ipcMain.handle(CHANNELS.PAGE_CREATE, (event, payload) =>
    active.handlePage(event, 'create', payload),
  );
  ipcMain.handle(CHANNELS.PAGE_GET, (event, payload) => active.handlePage(event, 'get', payload));
  ipcMain.handle(CHANNELS.PAGE_CANCEL, (event, payload) => active.handlePageCancel(event, payload));
  ipcMain.handle(CHANNELS.DIALOG_RESPOND, (event, payload) => active.handleDialog(event, payload));
  app.once('will-quit', () => active.dispose());
  logger.info('Browser-panel passkeys enabled', { binary });
}
