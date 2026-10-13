import { expect, it } from 'vitest';
// Verbatim canonical fixture from intent#6693, 203135af4c67a0df226bb9f6df94a68e3795c1ec.
import contract from './mock/fixtures/note-delete-grace-contract.json';
import {
  parseNoteDeleteScheduleRequest,
  parseNoteDeleteOperationResponse,
  parseNoteDeleteStatusResponse,
} from './note-delete';
it('consumes the published note.deleteSchedule and pending receipt without translation', () => {
  expect(contract.version).toBe('13.10');
  expect(parseNoteDeleteScheduleRequest(contract.schedule)).toEqual(contract.schedule);
  const envelope = { epoch: contract.epoch, serverTickMs: 1000, sequence: 1 };
  const response = { ...envelope, operation: contract.pending };
  expect(
    parseNoteDeleteOperationResponse(
      response,
      {
        workspaceId: contract.schedule.workspaceId,
        noteId: contract.schedule.noteId,
        operationKey: contract.schedule.operationKey,
      },
      true,
    ),
  ).toEqual(response);
  const marker = {
    operationKey: contract.pending.operationKey,
    noteId: contract.pending.noteId,
    noteInstanceId: contract.pending.noteInstanceId,
    state: contract.pending.state,
    sequence: contract.pending.sequence,
    deadlineTickMs: contract.pending.deadlineTickMs,
    deleteAt: contract.pending.deleteAt,
  };
  const status = {
    ...envelope,
    current: {
      noteInstanceId: contract.schedule.noteInstanceId,
      revision: contract.schedule.expectedVersion,
      sourceRevision: contract.schedule.sourceRevision,
    },
    pending: [{ ...marker, canCancel: true }],
    operation: null,
  };
  expect(
    parseNoteDeleteStatusResponse(status, {
      workspaceId: contract.schedule.workspaceId,
      noteId: contract.schedule.noteId,
    }),
  ).toEqual(status);
});
it('bounds public markers to the published workspace capacity and retains settled uncertainty', () => {
  const pending = {
    operationKey: contract.key,
    noteId: 'note-a',
    noteInstanceId: 'instance-a',
    state: 'OUTCOME_UNKNOWN',
    sequence: 1,
    deadlineTickMs: 16000,
    deleteAt: contract.pending.deleteAt,
    canCancel: false,
  };
  const workspace = {
    epoch: contract.epoch,
    serverTickMs: 17000,
    sequence: 1,
    current: null,
    pending: [pending],
    operation: null,
  };
  expect(
    parseNoteDeleteStatusResponse(workspace, { workspaceId: 'workspace-a' }).pending[0].state,
  ).toBe('OUTCOME_UNKNOWN');
  expect(() =>
    parseNoteDeleteStatusResponse(
      { ...workspace, pending: Array(contract.limits.workspaceEntries + 1).fill(pending) },
      { workspaceId: 'workspace-a' },
    ),
  ).toThrow();
});
