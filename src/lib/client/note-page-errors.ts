import type { NoteSaveOutcome, NoteSpliceOperation } from './note-pages';
function fields(error: unknown): { code?: unknown; rpcCode?: unknown; currentRevision?: unknown } {
  if (!error || typeof error !== 'object') return {};
  const value = error as {
    code?: unknown;
    rpcCode?: unknown;
    data?: { code?: unknown; currentRevision?: unknown };
  };
  return {
    code: value.data?.code ?? value.code,
    rpcCode: value.rpcCode,
    currentRevision: value.data?.currentRevision,
  };
}
export function isMissingNote(error: unknown): boolean {
  const value = fields(error);
  return value.rpcCode === -32602 && value.code === 'not-found';
}
export function rejectedNoteSave(
  error: unknown,
  operation: NoteSpliceOperation,
): NoteSaveOutcome | null {
  const value = fields(error);
  const conflict = value.rpcCode === -32005 && value.code === 'note-revision-conflict';
  const rejected =
    value.rpcCode === -32602 && ['invalid-params', 'note-page-budget'].includes(String(value.code));
  if (!conflict && !rejected) return null;
  return {
    kind: 'noteOperationStatus',
    scope: operation.scope,
    operationId: operation.operationId,
    payloadDigest: operation.payloadDigest,
    outcome: conflict ? 'conflict' : 'rejected',
    error: {
      code: String(value.code),
      ...(typeof value.currentRevision === 'string'
        ? { currentRevision: value.currentRevision }
        : {}),
    },
  };
}
