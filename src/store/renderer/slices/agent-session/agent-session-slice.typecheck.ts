import type { AgentSession } from '$shared/types';

import {
  bulkUpsertSessions,
  restoreStoredSessions,
  upsertSession,
  updateSession,
} from './agent-session-slice';
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

function typecheckMetadataPatchBoundary(): void {
  void updateSession('a1', {
    metadataPatch: {
      provider: { op: 'set', value: 'codex' },
      specialist: { op: 'clear' },
      extension: { op: 'set', value: null },
    },
  });
  void updateSession('a1', { name: 'Name' }, { reasoningEffortSource: 'encoder' });
  // @ts-expect-error copied sessions cannot assert metadata ownership
  void updateSession('a1', storedSession);
  // @ts-expect-error spreading a snapshot must not bypass the boundary
  void updateSession('a1', { ...wireSession, name: 'Name' });
  const copied = { metadata: storedSession.metadata, model: 'model' };
  // @ts-expect-error variables containing raw metadata are rejected too
  void updateSession('a1', copied);
  // @ts-expect-error raw metadata is not a patch
  void updateSession('a1', { metadata: { provider: 'codex' } });
  // @ts-expect-error copied metadata is not a map of operations
  void updateSession('a1', { metadataPatch: { ...storedSession.metadata } });
  // @ts-expect-error undefined is not a set value; clear explicitly
  void updateSession('a1', { metadataPatch: { provider: { op: 'set', value: undefined } } });
  // @ts-expect-error known keys retain their value types
  void updateSession('a1', { metadataPatch: { isBackground: { op: 'set', value: 'yes' } } });
  const ambiguous = { op: 'clear' as const, value: 'codex' };
  // @ts-expect-error clear cannot carry a set value, even through a variable
  void updateSession('a1', { metadataPatch: { provider: ambiguous } });
  const legacyOptions = {
    reasoningEffortSource: 'control' as const,
    projectedMetadataKeys: ['provider'],
  };
  // @ts-expect-error parallel ownership lists are forbidden, including variables
  void updateSession('a1', { name: 'Name' }, legacyOptions);
  // @ts-expect-error spreading legacy options does not bypass the boundary
  void updateSession('a1', { name: 'Name' }, { ...legacyOptions });
}
void typecheckMetadataPatchBoundary;
