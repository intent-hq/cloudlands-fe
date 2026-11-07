/**
 * Pair-link IPC (main process): Settings → Machines → "Paste an intent://
 * link", and the shared pipeline for links opened from outside the app.
 */

import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createValidatedHandler } from '../../../main/ipc-validation-middleware';
import * as connectionsStore from './desktop-connections-store';
import { saveOwnerConnection } from './backend.ipc';
import { BackendCompatibilityError, inspectPairCredential, invitedRole } from './invited-principal';
import { createPairLinks, type PairLinks } from './pair-link';
import type { PairLinkInspectResult } from '$shared/types/pair-link';

const CHANNELS = IPC_CHANNELS.CONNECTIONS;
const MAX_LINK_LENGTH = 4096;

let pairLinks: PairLinks | null = null;
let handlersRegistered = false;

/** The process-wide pair-link pipeline (pending credentials live here). */
export function getPairLinks(): PairLinks {
  pairLinks ??= createPairLinks({
    inspect: inspectPairCredential,
    findMatching: connectionsStore.findMatching,
    add: saveOwnerConnection,
    isInvitation: (snapshot) => invitedRole(snapshot) !== null,
    compatibilityMessage: (error) =>
      error instanceof BackendCompatibilityError ? error.message : null,
  });
  return pairLinks;
}

const PendingSchema = z.object({ pendingId: z.string().min(1).max(64) }).strict();

export function registerPairLinkHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  // Validated by hand: the link carries the owner token, so no middleware
  // may record or echo the payload.
  ipcMain.handle(CHANNELS.PAIR_LINK_INSPECT, async (_event, params: unknown) => {
    const uri = (params as { uri?: unknown } | null)?.uri;
    if (typeof uri !== 'string' || uri.length > MAX_LINK_LENGTH)
      return { ok: false, code: 'not-a-link' } satisfies PairLinkInspectResult;
    return getPairLinks().inspect(uri);
  });
  ipcMain.handle(
    CHANNELS.PAIR_LINK_COMMIT,
    createValidatedHandler(
      PendingSchema,
      async (_event, { pendingId }) => getPairLinks().commit(pendingId),
      CHANNELS.PAIR_LINK_COMMIT,
    ),
  );
  ipcMain.handle(
    CHANNELS.PAIR_LINK_DISCARD,
    createValidatedHandler(
      PendingSchema,
      async (_event, { pendingId }) => {
        getPairLinks().discard(pendingId);
        return { ok: true };
      },
      CHANNELS.PAIR_LINK_DISCARD,
    ),
  );
}
