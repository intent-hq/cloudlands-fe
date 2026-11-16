import { describe, expect, it, vi } from 'vitest';
import { resolveBootWindowBackendId } from './boot-window-backend';

const LOCAL = 'local';

describe('resolveBootWindowBackendId', () => {
  it('opens the persisted active machine when its client can be built', async () => {
    const connect = vi.fn(async () => undefined);
    await expect(
      resolveBootWindowBackendId({ activeId: 'remote-1', wantsLocal: false, connect }),
    ).resolves.toBe('remote-1');
    expect(connect).toHaveBeenCalledWith('remote-1');
  });

  it('falls back to the local machine when the active client cannot be built', async () => {
    const connect = vi.fn(async () => {
      throw new Error('missing token');
    });
    const onFallback = vi.fn();
    await expect(
      resolveBootWindowBackendId({ activeId: 'gone', wantsLocal: false, connect, onFallback }),
    ).resolves.toBe(LOCAL);
    expect(onFallback).toHaveBeenCalledWith('gone', expect.any(Error));
  });

  it('opens the local machine for an open link without connecting the active one', async () => {
    const connect = vi.fn(async () => undefined);
    await expect(
      resolveBootWindowBackendId({ activeId: 'remote-1', wantsLocal: true, connect }),
    ).resolves.toBe(LOCAL);
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not connect when the active machine is local', async () => {
    const connect = vi.fn(async () => undefined);
    await expect(
      resolveBootWindowBackendId({ activeId: LOCAL, wantsLocal: false, connect }),
    ).resolves.toBe(LOCAL);
    expect(connect).not.toHaveBeenCalled();
  });
});
