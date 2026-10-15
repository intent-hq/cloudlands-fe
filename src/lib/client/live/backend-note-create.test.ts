import { describe, expect, it, vi } from 'vitest';
import type { NoteCreateOptions } from '../app-client';
import { WorkspaceId } from '../../../shared/types/branded-ids';
import { createNoteCreate } from './backend-note-create';

const request = { workspaceId: WorkspaceId('ws'), title: 'Title', content: '' };
const wireNote = {
  id: 'created',
  workspaceId: 'ws',
  title: 'Title',
  content: '',
  rev: 0,
  contentType: 'markdown',
  tags: [],
  isPinned: false,
  isArchived: false,
  isDefault: false,
  visibility: 'workspace',
  metadata: {},
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
};
const receipt = {
  note: wireNote,
  convertedCount: 0,
  createdTaskNoteIds: [],
  createdTasks: [],
  warnings: [],
};
const options = (): NoteCreateOptions => ({
  requireCreationReceipt: true,
  idempotencyKey: 'operation-1',
  onDispatch: vi.fn(),
});

function client(response: unknown = receipt, error?: unknown, predispatch = false) {
  const wire = vi.fn(async () => {
    if (error) throw error;
    return response;
  });
  const backendRequest = vi.fn(
    async <T>(
      _method: string,
      _params?: unknown,
      opts?: Partial<Pick<NoteCreateOptions, 'onDispatch'>>,
    ): Promise<T> => {
      if (predispatch) throw new Error('offline');
      opts?.onDispatch?.();
      return (await wire()) as T;
    },
  );
  const rememberNoteWorkspace = vi.fn();
  return {
    create: createNoteCreate({ backendRequest, rememberNoteWorkspace }),
    backendRequest,
    wire,
    rememberNoteWorkspace,
  };
}

describe('authoritative note.create receipt', () => {
  it('sends the caller key and returns the exact daemon identity and revision', async () => {
    const c = client();
    const opts = options();
    const result = await c.create(request, opts);
    expect(c.backendRequest).toHaveBeenCalledWith(
      'note.create',
      {
        workspaceId: 'ws',
        title: 'Title',
        content: '',
        idempotencyKey: 'operation-1',
      },
      { onDispatch: expect.any(Function) },
    );
    expect(opts.onDispatch).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, createOutcome: 'confirmed', note: wireNote });
    expect(c.rememberNoteWorkspace).toHaveBeenCalledWith('created', 'ws');
  });

  it('adds the returned entity for legacy callers while retaining generated keys and two transport arguments', async () => {
    const c = client();
    expect(await c.create(request)).toMatchObject({ success: true, note: wireNote });
    await c.create(request);
    expect(c.backendRequest.mock.calls[0]).toHaveLength(2);
    const first = c.backendRequest.mock.calls[0][1] as { idempotencyKey: string };
    const second = c.backendRequest.mock.calls[1][1] as { idempotencyKey: string };
    expect(first.idempotencyKey).toEqual(expect.any(String));
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it.each([
    {},
    { id: 'guessed' },
    { note: { ...wireNote, id: '' } },
    { note: { ...wireNote, workspaceId: 'other' } },
    { note: { ...wireNote, rev: '0' } },
    { note: { ...wireNote, rev: -1 } },
    { note: { ...wireNote, rev: 0.5 } },
    { note: { ...wireNote, content: null } },
    { note: { ...wireNote, title: null } },
    ...['contentType', 'tags', 'isDefault', 'isPinned', 'isArchived', 'visibility'].map(
      (field) => ({
        note: { ...wireNote, [field]: undefined },
      }),
    ),
    { note: { ...wireNote, tags: [3] } },
    { note: { ...wireNote, metadata: [] } },
    { note: { ...wireNote, metadata: 'unknown' } },
  ])('never confirms a malformed or wrong-workspace reply: %j', async (response) => {
    const c = client(response);
    expect(await c.create(request, options())).toEqual({
      success: false,
      createOutcome: 'unknown',
    });
    expect(c.wire).toHaveBeenCalledOnce();
    expect(c.rememberNoteWorkspace).not.toHaveBeenCalled();
  });

  it.each([-32600, -32601, -32602, -32003])(
    'recognizes definite daemon refusal %s',
    async (rpcCode) => {
      const c = client(undefined, Object.assign(new Error('refused'), { rpcCode }));
      expect(await c.create(request, options())).toMatchObject({
        success: false,
        createOutcome: 'failed',
      });
      expect(c.wire).toHaveBeenCalledOnce();
    },
  );

  it.each([
    new Error('socket lost'),
    Object.assign(new Error('receipt storage failed'), { rpcCode: -32603 }),
  ])('retains ambiguity after transport or persistence failure', async (error) => {
    const c = client(undefined, error);
    expect(await c.create(request, options())).toMatchObject({
      success: false,
      createOutcome: 'unknown',
    });
    expect(c.wire).toHaveBeenCalledOnce();
  });

  it('rejects before dispatch when the host retires or the key is missing', async () => {
    const c = client();
    expect(
      await c.create(request, {
        ...options(),
        onDispatch() {
          throw new Error('retired');
        },
      }),
    ).toMatchObject({ success: false, createOutcome: 'failed' });
    expect(await c.create(request, { ...options(), idempotencyKey: '' })).toMatchObject({
      success: false,
      createOutcome: 'failed',
    });
    expect(c.wire).not.toHaveBeenCalled();
    expect(c.backendRequest).toHaveBeenCalledOnce();
  });

  it('does not confirm if the transport bypasses its dispatch callback', async () => {
    const create = createNoteCreate({ backendRequest: async <T>() => receipt as T });
    expect(await create(request, options())).toEqual({ success: false, createOutcome: 'unknown' });
  });
});
