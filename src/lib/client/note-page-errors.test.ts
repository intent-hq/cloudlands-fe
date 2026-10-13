import { expect, it } from 'vitest';
import { rejectedNoteSave, isMissingNote } from './note-page-errors';
const operation = {
  scope: { backendId: 'db', workspaceId: 'ws', noteId: 'note', noteInstanceId: 'inc' },
  operationId: 'op',
  payloadDigest: 'digest',
  baseRevision: 'r1',
  expiresAt: '2099-01-01T00:00:00Z',
  splices: [{ start: 0, end: 1, text: 'new' }],
};
it.each(['invalid-params', 'note-page-budget'])(
  'retains save identity on guaranteed no-mutation error %s',
  (code) => {
    expect(rejectedNoteSave({ rpcCode: -32602, data: { code } }, operation)).toMatchObject({
      outcome: 'rejected',
      scope: operation.scope,
      operationId: 'op',
      payloadDigest: 'digest',
      error: { code },
    });
  },
);
it.each([
  new Error('offline'),
  { rpcCode: -32603, code: 'internal-error' },
  { code: 'note-revision-conflict' },
  { rpcCode: -32602, code: 'note-operation-mismatch' },
  { rpcCode: -32602, code: 'note-operation-expired' },
])('does not invent a terminal outcome for uncertain or prior-operation errors', (error) => {
  expect(rejectedNoteSave(error, operation)).toBeNull();
});
it('requires the typed missing-entity code, never a message or expired cursor', () => {
  expect(isMissingNote({ rpcCode: -32602, data: { code: 'not-found' } })).toBe(true);
  expect(isMissingNote(new Error('Note not found'))).toBe(false);
  expect(isMissingNote({ rpcCode: -32602, code: 'note-page-expired' })).toBe(false);
});
