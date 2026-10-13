import { describe, expect, it, vi } from 'vitest';
import {
  installTaskEventCompletionOwner,
  retainTaskEventCompletion,
} from './task-event-completion';

describe('task event completion ownership', () => {
  it('settles delayed work on teardown and cannot cancel a replacement owner', () => {
    const oldStop = installTaskEventCompletionOwner();
    const old = vi.fn();
    retainTaskEventCompletion(old);
    const stop = installTaskEventCompletionOwner();
    expect(old).toHaveBeenCalledOnce();
    const current = vi.fn();
    retainTaskEventCompletion(current);
    oldStop();
    expect(current).not.toHaveBeenCalled();
    stop();
    expect(current).toHaveBeenCalledOnce();
  });
  it('settles work immediately without a reader and forgets completed requests', () => {
    const absent = vi.fn();
    retainTaskEventCompletion(absent);
    expect(absent).toHaveBeenCalledOnce();
    const stop = installTaskEventCompletionOwner();
    const complete = vi.fn();
    retainTaskEventCompletion(complete)();
    stop();
    expect(complete).not.toHaveBeenCalled();
  });
});
