import { describe, expect, it, vi } from 'vitest';
import { runRecoveryRead } from './recovery-read-queue';
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
  it('does not let an old authority block or evict replacement work', async () => {
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
    const next = runRecoveryRead('replace', b.token, 'ordinary', 'list', read);
    oldFinish();
    await first;
    expect(runRecoveryRead('replace', b.token, 'ordinary', 'list', read)).toBe(next);
    expect(read).toHaveBeenCalledTimes(1);
    newFinish();
    await next;
  });
});
