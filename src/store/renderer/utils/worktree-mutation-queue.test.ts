import { describe, expect, it, vi } from 'vitest';
import {
  getGitMutationVersion,
  isGitMutationPending,
  queueFileMutation,
  reserveGitMutation,
  waitForGitMutations,
} from './worktree-mutation-queue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('shared worktree mutation barrier', () => {
  it('waits through transactions added while a read is waiting for the root', async () => {
    const first = reserveGitMutation('read-wait');
    const read = vi.fn();
    const reading = waitForGitMutations('read-wait').then(read);
    const second = reserveGitMutation('read-wait');
    await first.release();
    expect(read).not.toHaveBeenCalled();
    await waitForGitMutations('read-wait', 'unrelated-root');
    expect(read).not.toHaveBeenCalled();
    await second.release();
    await reading;
    expect(read).toHaveBeenCalledTimes(1);
    expect(isGitMutationPending('read-wait')).toBe(false);
  });

  it('orders save → Git transaction → later save, preserving other-workspace progress', async () => {
    const saved = deferred();
    const events: string[] = [];
    const first = queueFileMutation('ordered', 'a.ts', () => {
      events.push('save');
      return saved.promise;
    });
    const git = reserveGitMutation('ordered');
    const gitCall = git.run(async () => {
      events.push('git');
    });
    const last = queueFileMutation('ordered', 'b.ts', async () => {
      events.push('later-save');
    });
    await queueFileMutation('other', 'a.ts', async () => {
      events.push('other-save');
    });
    expect(events).toEqual(['save', 'other-save']);
    saved.resolve();
    await first;
    await gitCall;
    expect(events).toEqual(['save', 'other-save', 'git']);
    await git.release();
    await last;
    expect(events).toEqual(['save', 'other-save', 'git', 'later-save']);
  });

  it('retains cancelled-owner transport tails and failure does not poison the next write', async () => {
    const transport = deferred();
    const first = reserveGitMutation('cancelled');
    const call = first.run(() =>
      transport.promise.then(() => {
        throw new Error('failed');
      }),
    );
    const rejected = expect(call).rejects.toThrow('failed');
    const released = first.release();
    const second = reserveGitMutation('cancelled');
    const next = vi.fn(async () => 'next');
    const nextCall = second.run(next);
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
    transport.resolve();
    await rejected;
    await released;
    await expect(nextCall).resolves.toBe('next');
    await second.release();
    expect(isGitMutationPending('cancelled')).toBe(false);
  });

  it('keeps unrelated file paths parallel and separate roots independent', async () => {
    const held = deferred();
    const first = queueFileMutation('paths', 'a.ts', () => held.promise);
    await queueFileMutation('paths', 'b.ts', async () => undefined);
    held.resolve();
    await first;
    const main = reserveGitMutation('roots');
    const secondary = reserveGitMutation('roots', 'root-2');
    await secondary.run(async () => undefined);
    await secondary.release();
    expect(isGitMutationPending('roots')).toBe(true);
    await main.release();
    expect(getGitMutationVersion('roots')).toBe(2);
    expect(getGitMutationVersion('roots', 'root-2')).toBe(2);
  });

  it('cannot deadlock when a file is admitted between two root transactions', async () => {
    const first = reserveGitMutation('interleave');
    const events: string[] = [];
    const file = queueFileMutation('interleave', 'a.ts', async () => {
      events.push('file');
    });
    const second = reserveGitMutation('interleave');
    const write = second.run(async () => {
      events.push('second');
    });
    await first.release();
    await file;
    await write;
    await second.release();
    expect(events).toEqual(['file', 'second']);
  });
});
