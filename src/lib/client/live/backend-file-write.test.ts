import { describe, expect, it, vi } from 'vitest';
import { createFileWrite } from './backend-file-write';
import { BackendError } from './backend-transport-types';
import type { FileWriteOptions } from '../file-write-types';

const text = { kind: 'editable-text' as const, content: '' };
function transport() {
  return vi.fn(
    async (
      _method: string,
      _params?: unknown,
      options?: Partial<FileWriteOptions>,
    ): Promise<unknown> => {
      options?.onDispatch?.();
      return { ok: true };
    },
  );
}

describe('canonical file.write encoder', () => {
  it('preserves legacy two-argument transport and complete empty text writes', async () => {
    const request = transport();
    const write = createFileWrite(request as Parameters<typeof createFileWrite>[0]);
    expect(await write('ws', 'a.ts', text)).toEqual({ success: true });
    expect(request).toHaveBeenCalledWith('file.write', {
      workspaceId: 'ws',
      path: 'a.ts',
      content: '',
      idempotencyKey: expect.any(String),
    });
  });

  it('runs final admission before the wire and preserves the exact request and receipt', async () => {
    const request = transport();
    const onDispatch = vi.fn();
    const write = createFileWrite(request as Parameters<typeof createFileWrite>[0]);
    expect(await write('ws', 'a.ts', text, { onDispatch })).toEqual({ success: true });
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      'file.write',
      {
        workspaceId: 'ws',
        path: 'a.ts',
        content: '',
        idempotencyKey: expect.any(String),
      },
      { onDispatch: expect.any(Function) },
    );
  });

  it.each([{}, { ok: false }, null, undefined])(
    'does not confirm a malformed receipt %j',
    async (receipt) => {
      const request = transport();
      request.mockImplementation(async (_method, _params, options) => {
        options?.onDispatch?.();
        return receipt;
      });
      const write = createFileWrite(request as Parameters<typeof createFileWrite>[0]);
      expect(await write('ws', 'a.ts', text, { onDispatch() {} })).toEqual({
        success: false,
        outcome: 'uncertain',
      });
    },
  );

  it.each([
    { error: new Error('timeout'), outcome: 'uncertain' },
    {
      error: new BackendError({ code: 'forbidden', message: 'permission denied', rpcCode: -32003 }),
      outcome: 'failed',
    },
  ])('distinguishes $outcome after dispatch without retrying', async ({ error, outcome }) => {
    const request = transport();
    request.mockImplementation(async (_method, _params, options) => {
      options?.onDispatch?.();
      throw error;
    });
    const write = createFileWrite(request as Parameters<typeof createFileWrite>[0]);
    expect(await write('ws', 'a.ts', text, { onDispatch() {} })).toEqual({
      success: false,
      outcome,
      error: error.message,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('classifies a pre-dispatch authority refusal as failed with no actual write', async () => {
    const request = transport();
    const wire = vi.fn();
    request.mockImplementation(async (_method, _params, options) => {
      options?.onDispatch?.();
      wire();
      return { ok: true };
    });
    const write = createFileWrite(request as Parameters<typeof createFileWrite>[0]);
    expect(
      await write('ws', 'a.ts', text, {
        onDispatch() {
          throw new Error('retired');
        },
      }),
    ).toEqual({ success: false, outcome: 'failed', error: 'retired' });
    expect(wire).not.toHaveBeenCalled();
  });
});

it('cannot confirm a host transport that skipped final admission', async () => {
  const request = transport();
  request.mockResolvedValue({ ok: true });
  const write = createFileWrite(request as Parameters<typeof createFileWrite>[0]);
  const onDispatch = vi.fn();
  expect(await write('ws', 'a.ts', text, { onDispatch })).toEqual({
    success: false,
    outcome: 'uncertain',
  });
  expect(onDispatch).not.toHaveBeenCalled();
});
