import type { AgentSession } from '$shared/types';

import { bulkUpsertSessions, restoreStoredSessions, upsertSession } from './agent-session-slice';
import type { StoredAgentSession } from './agent-session-types';

declare const wireSession: AgentSession;
declare const storedSession: StoredAgentSession;

function typecheckSessionUpsertBoundary(): void {
  // Wire snapshots flow through the wire upserts.
  void upsertSession(wireSession);
  void bulkUpsertSessions([wireSession]);

  // Stored rows carry FE-owned keys; the wire upserts reject them so a stored row
  // can never be re-read as an incoming snapshot and lose those fields.
  // @ts-expect-error a stored session is not a wire snapshot
  void upsertSession(storedSession);
  // @ts-expect-error a stored session is not a wire snapshot
  void bulkUpsertSessions([storedSession]);
  // @ts-expect-error any FE-owned key marks the object as stored, not wire
  void upsertSession({ ...wireSession, processQueueHint: 'waiting' });

  // Stored rows are restored (or locally patched) via restoreStoredSessions.
  void restoreStoredSessions([storedSession]);
  void restoreStoredSessions([{ ...storedSession, retiredAt: undefined }]);
}

void typecheckSessionUpsertBoundary;
