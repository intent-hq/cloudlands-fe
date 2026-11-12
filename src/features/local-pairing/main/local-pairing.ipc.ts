/**
 * Local pairing IPC, requester side (main process): Settings → Machines →
 * Add machine → Intent on this computer.
 *
 * `LIST` reads the discovery folder; `REDEEM` redeems a code against one
 * listed Intent and saves it as a machine. Only the instance id and the code
 * cross from the renderer; the credential token never goes back.
 */

import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { LocalIntentsListResult, LocalRedeemResult } from '$shared/types/local-pairing';
import { getLocalBackendClient, saveOwnerConnection } from '../../backend/main/backend.ipc';
import { resolveIntentdDataDir } from '../../backend/main/intentd-data-dir';
import {
  desktopProductName,
  localDaemonsDir,
  readLocalDaemons,
  type LocalDaemonRecord,
  type OwnDaemon,
} from './local-daemon-discovery';
import { createLocalPairRedeemer, exchangeOverLocalPair } from './local-pair-redeem';

const CHANNELS = IPC_CHANNELS.LOCAL_PAIRING;
const OWN_FINGERPRINT_TTL_MS = 30_000;
const OWN_FINGERPRINT_TIMEOUT_MS = 2_000;

let handlersRegistered = false;
let ownFingerprint: { value: string | null; at: number } | null = null;

/** This app's daemon certificate, to hide it from the list. Null when unknown. */
async function readOwnFingerprint(): Promise<string | null> {
  if (ownFingerprint && Date.now() - ownFingerprint.at < OWN_FINGERPRINT_TTL_MS)
    return ownFingerprint.value;
  let value: string | null = null;
  try {
    const info = await Promise.race([
      getLocalBackendClient().request<{ certFingerprint?: unknown }>('server.pairingInfo', {}),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), OWN_FINGERPRINT_TIMEOUT_MS)),
    ]);
    value = typeof info?.certFingerprint === 'string' ? info.certFingerprint : null;
  } catch {
    value = null;
  }
  ownFingerprint = { value, at: Date.now() };
  return value;
}

async function ownDaemon(): Promise<OwnDaemon> {
  return { fingerprint: await readOwnFingerprint(), dataDir: resolveIntentdDataDir() };
}

async function readRecords(): Promise<LocalDaemonRecord[] | null> {
  return readLocalDaemons(
    { dir: localDaemonsDir(), uid: typeof process.getuid === 'function' ? process.getuid() : null },
    await ownDaemon(),
  );
}

let redeemer: ReturnType<typeof createLocalPairRedeemer> | null = null;

function getRedeemer() {
  redeemer ??= createLocalPairRedeemer({
    findRecord: async (instanceId) =>
      (await readRecords())?.find((record) => record.instanceId === instanceId) ?? null,
    exchange: (request) => exchangeOverLocalPair(request),
    add: saveOwnerConnection,
    appName: desktopProductName(app.getName(), app.isPackaged),
  });
  return redeemer;
}

const INSTANCE_ID = /^[A-Za-z0-9-]{1,64}$/;

export function registerLocalPairingHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle(CHANNELS.LIST, async (): Promise<LocalIntentsListResult> => {
    const records = await readRecords();
    if (!records) return { ok: false, code: 'unavailable' };
    return {
      ok: true,
      intents: records.map((record) => ({
        instanceId: record.instanceId,
        displayName: record.displayName,
        dataDir: record.dataDir,
        accepting: record.port !== null,
      })),
    };
  });

  // Validated by hand: the payload carries the code, so no middleware may
  // record or echo it.
  ipcMain.handle(CHANNELS.REDEEM, async (_event, params: unknown): Promise<LocalRedeemResult> => {
    const value = (params ?? {}) as { instanceId?: unknown; code?: unknown };
    if (typeof value.instanceId !== 'string' || !INSTANCE_ID.test(value.instanceId))
      return { ok: false, error: { code: 'gone' } };
    if (typeof value.code !== 'string' || value.code.length > 32)
      return { ok: false, error: { code: 'code-format' } };
    return getRedeemer()(value.instanceId, value.code);
  });
}
