import { afterEach, describe, expect, it, vi } from 'vitest';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';
import { runRecoveryRead, retireRecoveryReads } from './recovery-read-queue';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
function authority() {
  let alive = true;
  const token: RecoveryLifetime = {
    key: {},
    isCurrent: () => alive,
    commit: (write) => {
      if (!alive) return false;
      write();
      return true;
    },
  };
  return {
    token,
    retire: () => {
      alive = false;
    },
  };
}
afterEach(() => vi.restoreAllMocks());
describe('shared ordinary and recovery read admission', () => {
  it('shares demanded ordinary work and then starts a fresh recovery with peak one', async () => {
    const a = authority();
    let finish!: (value: string) => void;
    let active = 0,
      peak = 0;
    const ordinary = vi.fn(() => {
      peak = Math.max(peak, ++active);
      return new Promise<string>((done) => {
        finish = (value) => {
          active--;
          done(value);
        };
      });
    });
    const first = runRecoveryRead('shared', a.token, 'ordinary', 'list', ordinary);
    expect(runRecoveryRead('shared', a.token, 'ordinary', 'list', ordinary)).toBe(first);
    const snapshot = vi.fn(async () => {
      peak = Math.max(peak, ++active);
      active--;
      return 'fresh';
    });
    const recovered = runRecoveryRead('shared', a.token, 'recovery', 'list', snapshot);
    expect(snapshot).not.toHaveBeenCalled();
    finish('old');
    expect(await first).toBe('old');
    expect(await recovered).toBe('fresh');
    expect(ordinary).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(peak).toBe(1);
  });
  it('waits for a superseded ordinary read before starting its replacement', async () => {
    const a = authority();
    let finish!: () => void;
    const first = runRecoveryRead(
      'push',
      a.token,
      'ordinary',
      'list',
      () =>
        new Promise<void>((done) => {
          finish = done;
        }),
    );
    a.retire();
    const nextToken = { ...authority().token, key: a.token.key };
    const read = vi.fn(async () => 'new');
    const next = runRecoveryRead('push', nextToken, 'ordinary', 'list', read);
    expect(read).not.toHaveBeenCalled();
    finish();
    await first;
    expect(await next).toBe('new');
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('checks queued authority again before transport dispatch', async () => {
    const a = authority();
    let finish!: () => void;
    const first = runRecoveryRead(
      'retire',
      a.token,
      'ordinary',
      'a',
      () =>
        new Promise<void>((done) => {
          finish = done;
        }),
    );
    const next = vi.fn(async () => 1);
    const pending = runRecoveryRead('retire', a.token, 'recovery', 'b', next);
    a.retire();
    finish();
    await first;
    await expect(pending).rejects.toThrow('expired');
    expect(next).not.toHaveBeenCalled();
  });
  it('does not let an old transport block or evict replacement work', async () => {
    const session = vi
      .spyOn(rendererEventRecovery, 'capturePhysicalSessionIdentity')
      .mockReturnValue({});
    const a = authority(),
      b = authority();
    let oldFinish!: () => void, newFinish!: () => void;
    const first = runRecoveryRead(
      'replace',
      a.token,
      'ordinary',
      'list',
      () =>
        new Promise<void>((done) => {
          oldFinish = done;
        }),
    );
    a.retire();
    const read = vi.fn(
      () =>
        new Promise<void>((done) => {
          newFinish = done;
        }),
    );
    session.mockReturnValue({});
    const next = runRecoveryRead('replace', b.token, 'ordinary', 'list', read);
    oldFinish();
    await first;
    expect(runRecoveryRead('replace', b.token, 'ordinary', 'list', read)).toBe(next);
    expect(read).toHaveBeenCalledTimes(1);
    newFinish();
    await next;
  });
});

describe('physical request accounting', () => {
  const settle = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  };
  it.each(['ordinary', 'recovery'] as const)(
    'keeps a held request across resource epoch replacement before %s work',
    async (mode) => {
      const old = authority();
      let finish!: () => void;
      const first = runRecoveryRead(
        `epoch-${mode}`,
        old.token,
        'ordinary',
        'list',
        () =>
          new Promise<void>((done) => {
            finish = done;
          }),
      );
      old.retire();
      const next = vi.fn(async () => 'new');
      const fresh = runRecoveryRead(`epoch-${mode}`, authority().token, mode, 'list', next);
      await settle();
      expect(next).not.toHaveBeenCalled();
      finish();
      await first;
      expect(await fresh).toBe('new');
      expect(next).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps physical work after explicit owner retirement and rejects queued old-authority starts', async () => {
    const old = authority();
    let finish!: () => void;
    const first = runRecoveryRead(
      'remount',
      old.token,
      'ordinary',
      'list',
      () =>
        new Promise<void>((done) => {
          finish = done;
        }),
    );
    const staleRead = vi.fn(async () => 'stale');
    const stale = runRecoveryRead('remount', old.token, 'recovery', 'list', staleRead).catch(
      (error) => error.message,
    );
    retireRecoveryReads('remount');
    const read = vi.fn(async () => 'new');
    const next = runRecoveryRead('remount', authority().token, 'ordinary', 'list', read);
    await settle();
    expect(read).not.toHaveBeenCalled();
    finish();
    await first;
    expect(await stale).toMatch('expired');
    expect(await next).toBe('new');
    expect(staleRead).not.toHaveBeenCalled();
  });
  it.each(['ordinary', 'recovery'] as const)(
    'retains a timed-out physical request before %s retry',
    async (mode) => {
      const a = authority();
      let drain!: (value: { errors: unknown[]; retired: boolean }) => void;
      const timeout = new RecoveryRequestTimeoutError(
        new Promise((done) => {
          drain = done;
        }),
      );
      const failed = runRecoveryRead(`timeout-${mode}`, a.token, 'recovery', 'list', async () => {
        throw timeout;
      });
      await expect(failed).rejects.toBe(timeout);
      const read = vi.fn(async () => 'new');
      const next = runRecoveryRead(`timeout-${mode}`, a.token, mode, 'list', read);
      await settle();
      expect(read).not.toHaveBeenCalled();
      drain({ errors: [], retired: false });
      expect(await next).toBe('new');
      expect(read).toHaveBeenCalledTimes(1);
    },
  );
  it('does not share a logically rejected ordinary request with its retry', async () => {
    const a = authority();
    let drain!: (value: { errors: unknown[]; retired: boolean }) => void;
    const timeout = new RecoveryRequestTimeoutError(
      new Promise((done) => {
        drain = done;
      }),
    );
    const failed = runRecoveryRead('ordinary-timeout', a.token, 'ordinary', 'list', async () => {
      throw timeout;
    });
    await expect(failed).rejects.toBe(timeout);
    const read = vi.fn(async () => 'retry');
    const next = runRecoveryRead('ordinary-timeout', a.token, 'ordinary', 'list', read);
    expect(next).not.toBe(failed);
    await settle();
    expect(read).not.toHaveBeenCalled();
    drain({ errors: [], retired: false });
    expect(await next).toBe('retry');
  });
});

describe('late completion authority scope', () => {
  it.each([
    {
      rpcCode: -32003,
      data: undefined,
      retireOnNotFound: false,
      retired: false,
      expectRetire: true,
    },
    {
      rpcCode: -32602,
      data: { code: 'not-found' },
      retireOnNotFound: true,
      retired: false,
      expectRetire: true,
    },
    {
      rpcCode: -32602,
      data: { code: 'not-found' },
      retireOnNotFound: false,
      retired: false,
      expectRetire: false,
    },
    {
      rpcCode: -32602,
      data: undefined,
      retireOnNotFound: true,
      retired: false,
      expectRetire: false,
    },
    {
      rpcCode: -32003,
      data: undefined,
      retireOnNotFound: true,
      retired: true,
      expectRetire: false,
    },
  ])('settles scoped failure $rpcCode (missing=$retireOnNotFound, retired=$retired)', async (c) => {
    const order: string[] = [];
    const retire = vi.fn(() => {
      order.push('retire');
      return true;
    });
    const capture = vi.spyOn(rendererEventRecovery, 'captureRetirement').mockReturnValue(retire);
    let finish!: (outcome: { errors: unknown[]; retired: boolean }) => void;
    const physical = new Promise<{ errors: unknown[]; retired: boolean }>((resolve) => {
      finish = resolve;
    });
    const a = authority();
    const error = { rpcCode: c.rpcCode, data: c.data };
    const timeout = new RecoveryRequestTimeoutError(physical);
    const result = runRecoveryRead(
      'late-scope',
      a.token,
      'ordinary',
      'get:child',
      async () => {
        order.push('read');
        throw timeout;
      },
      { retireOnNotFound: c.retireOnNotFound },
    );
    await expect(result).rejects.toBe(timeout);
    const next = runRecoveryRead('late-scope', a.token, 'ordinary', 'get:child', async () => {
      order.push('next');
      return 'fresh';
    });
    expect(capture).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['read']);
    finish({ errors: [error], retired: c.retired });
    await next;
    expect(retire).toHaveBeenCalledTimes(c.expectRetire ? 1 : 0);
    expect(order).toEqual(c.expectRetire ? ['read', 'retire', 'next'] : ['read', 'next']);
  });
});

describe('point reads sharing a collection lane', () => {
  it.each([false, true])(
    'reports point denial without retiring collection (late=%s)',
    async (late) => {
      const retire = vi.fn(() => true);
      vi.spyOn(rendererEventRecovery, 'captureRetirement').mockReturnValue(retire);
      const a = authority();
      const failure = { rpcCode: -32003 };
      const observed: unknown[] = [];
      let complete!: (value: { errors: unknown[]; retired: boolean }) => void;
      const physical = new Promise<{ errors: unknown[]; retired: boolean }>((resolve) => {
        complete = resolve;
      });
      const rejection = late ? new RecoveryRequestTimeoutError(physical) : failure;
      const result = runRecoveryRead(
        'collection-point',
        a.token,
        'ordinary',
        'get:one',
        async () => {
          throw rejection;
        },
        {
          retireOnDenied: false,
          retireOnNotFound: false,
          onFailure: (error) => {
            observed.push(error);
          },
        },
      );
      await expect(result).rejects.toBe(rejection);
      const next = runRecoveryRead('collection-point', a.token, 'ordinary', 'get:one', async () => {
        expect(observed).toContain(failure);
        return 'sibling remains available';
      });
      if (late) complete({ errors: [failure], retired: false });
      expect(await next).toBe('sibling remains available');
      expect(retire).not.toHaveBeenCalled();
      expect(observed.filter((error) => error === failure)).toHaveLength(1);
    },
  );
});
