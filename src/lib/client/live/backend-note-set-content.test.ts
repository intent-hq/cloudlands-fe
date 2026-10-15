import { describe, expect, it, vi } from 'vitest';
import { createNoteSetContent } from './backend-note-set-content';
import type { NoteSetContentOptions } from '../app-client';

const receipt = { ok: true, noteId: 'note', newContent: 'merged 🦊', rev: 9 };
function setup(result: unknown = receipt, dispatch = true, error?: unknown) {
  const request = vi.fn(
    async <T>(
      _method: string,
      _params?: unknown,
      options?: Partial<NoteSetContentOptions>,
    ): Promise<T> => {
      if (dispatch) options?.onDispatch?.();
      if (error) throw error;
      return result as T;
    },
  );
  const resolve = vi.fn(async () => 'fallback');
  return {
    request,
    resolve,
    setContent: createNoteSetContent({ backendRequest: request, resolveNoteWorkspaceId: resolve }),
  };
}
describe('strict note.setContent client', () => {
  it('sends exact protocol identities/content/base revision and decodes the real receipt', async () => {
    const run = setup();
    const guard = vi.fn();
    expect(
      await run.setContent('note', 'draft λ', 4, 'ws', {
        requireContentReceipt: true,
        onDispatch: guard,
      }),
    ).toEqual({ success: true, contentOutcome: 'confirmed', newContent: 'merged 🦊', noteRev: 9 });
    expect(run.request).toHaveBeenCalledWith(
      'note.setContent',
      { workspaceId: 'ws', noteId: 'note', content: 'draft λ', expectedVersion: 4 },
      { onDispatch: expect.any(Function) },
    );
    expect(guard).toHaveBeenCalledTimes(1);
    expect(run.resolve).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    null,
    {},
    true,
    { ...receipt, ok: false },
    { ...receipt, noteId: 'different' },
    { ...receipt, newContent: undefined },
    { ...receipt, rev: undefined },
    { ...receipt, rev: NaN },
    { ...receipt, rev: 3 },
    { ...receipt, rev: 4.5 },
  ])('does not confirm malformed or mismatched receipt %j', async (result) => {
    const run = setup(result); // Undefined is an intentional malformed response, not the setup default.
    if (result === undefined) run.request.mockResolvedValue(undefined);
    expect(
      await run.setContent('note', 'draft', 4, 'ws', {
        requireContentReceipt: true,
        onDispatch() {},
      }),
    ).toMatchObject({ success: false, contentOutcome: 'unknown' });
  });
  it('does not confirm a transport that skipped its dispatch callback', async () => {
    const run = setup(receipt, false);
    expect(
      await run.setContent('note', 'draft', 4, 'ws', {
        requireContentReceipt: true,
        onDispatch() {},
      }),
    ).toMatchObject({ success: false, contentOutcome: 'unknown' });
  });
  it.each([
    { workspaceId: undefined, rev: 4 },
    { workspaceId: '', rev: 4 },
    { workspaceId: 'ws', rev: undefined },
    { workspaceId: 'ws', rev: -1 },
    { workspaceId: 'ws', rev: NaN },
  ])(
    'refuses incomplete strict admission without workspace fallback %j',
    async ({ workspaceId, rev }) => {
      const run = setup();
      expect(
        await run.setContent('note', 'draft', rev, workspaceId, {
          requireContentReceipt: true,
          onDispatch() {},
        }),
      ).toMatchObject({ success: false, contentOutcome: 'failed' });
      expect(run.resolve).not.toHaveBeenCalled();
      expect(run.request).not.toHaveBeenCalled();
    },
  );
  it('lets a final guard refuse before dispatch', async () => {
    const run = setup();
    expect(
      await run.setContent('note', 'draft', 4, 'ws', {
        requireContentReceipt: true,
        onDispatch() {
          throw new Error('retired');
        },
      }),
    ).toMatchObject({ success: false, contentOutcome: 'failed' });
  });
  it.each([-32603, -32005, undefined])(
    'keeps post-dispatch errors uncertain unless definitely refused (%s)',
    async (rpcCode) => {
      const run = setup(receipt, true, Object.assign(new Error('failed'), { rpcCode }));
      expect(
        await run.setContent('note', 'draft', 4, 'ws', {
          requireContentReceipt: true,
          onDispatch() {},
        }),
      ).toMatchObject({ success: false, contentOutcome: 'unknown' });
    },
  );
  it('retains source compatibility without opt-in receipt or a known revision', async () => {
    const run = setup({});
    expect(await run.setContent('note', 'draft')).toEqual({ success: true });
    expect(run.resolve).toHaveBeenCalledWith('note');
    expect(run.request).toHaveBeenCalledWith('note.setContent', {
      workspaceId: 'fallback',
      noteId: 'note',
      content: 'draft',
    });
  });
});
