import { buffers, runSaga, stdChannel } from 'redux-saga';
import { take } from 'typed-redux-saga';
import { describe, expect, it, vi } from 'vitest';
import { ownedActionChannel } from './owned-action-channel';

type Command = { type: string; owner: string; value: number };

describe('ownedActionChannel', () => {
  it('filters before waking a waiting worker', async () => {
    const input = stdChannel<Command>();
    const received = vi.fn();
    const ownership = vi.fn((action: Command) => action.owner === 'original');
    const task = runSaga({ channel: input }, function* () {
      const commands = yield* ownedActionChannel(['confirm'], ownership, buffers.expanding(8));
      try {
        received(yield* take(commands));
      } finally {
        commands.close();
      }
    });
    input.put({ type: 'unrelated', owner: 'original', value: 1 });
    expect(ownership).not.toHaveBeenCalled();
    input.put({ type: 'confirm', owner: 'replacement', value: 2 });
    expect(received).not.toHaveBeenCalled();
    const command = { type: 'confirm', owner: 'original', value: 3 };
    input.put(command);
    await task.toPromise();
    expect(received).toHaveBeenCalledExactlyOnceWith(command);
  });

  it('does not let another owner evict a pending cancellation from a sliding buffer', async () => {
    const input = stdChannel<Command>();
    const commands = await runSaga({ channel: input }, function* () {
      return yield* ownedActionChannel(
        ['cancel'],
        (action: Command) => action.owner === 'original',
        buffers.sliding(1),
      );
    }).toPromise();
    try {
      const cancel = { type: 'cancel', owner: 'original', value: 1 };
      input.put(cancel);
      input.put({ type: 'cancel', owner: 'replacement', value: 2 });
      input.put({ type: 'unrelated', owner: 'original', value: 3 });
      const flushed = vi.fn();
      commands.flush(flushed);
      expect(flushed).toHaveBeenCalledExactlyOnceWith([cancel]);
    } finally {
      commands.close();
    }
  });

  it('uses current child ownership at ingress and preserves command order', async () => {
    const input = stdChannel<Command>();
    let child: string | undefined;
    const commands = await runSaga({ channel: input }, function* () {
      return yield* ownedActionChannel(
        ['confirm', 'cancel'],
        (action: Command) => action.owner === 'original' || action.owner === child,
        buffers.expanding(8),
      );
    }).toPromise();
    try {
      input.put({ type: 'confirm', owner: 'child', value: 0 });
      child = 'child';
      const confirm = { type: 'confirm', owner: 'child', value: 1 };
      const cancel = { type: 'cancel', owner: 'original', value: 2 };
      input.put(confirm);
      input.put(cancel);
      child = undefined;
      input.put({ type: 'confirm', owner: 'child', value: 3 });
      const flushed = vi.fn();
      commands.flush(flushed);
      expect(flushed).toHaveBeenCalledExactlyOnceWith([confirm, cancel]);
    } finally {
      commands.close();
    }
  });
});
