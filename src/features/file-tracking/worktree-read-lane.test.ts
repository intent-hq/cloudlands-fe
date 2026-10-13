import { expect, it, vi } from 'vitest';
import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';
import { trackWorktreeSnapshotRead } from './worktree-read-lane';
it('retains exclusive recovery ownership until a logically timed out driver drains', async () => {
  let drain!: (result: { retired: boolean; errors: unknown[] }) => void;
  const error = new RecoveryRequestTimeoutError(
    new Promise((resolve) => {
      drain = resolve;
    }),
  );
  await expect(
    trackWorktreeSnapshotRead('deadline-case', () => Promise.reject(error), 'recovery'),
  ).rejects.toBe(error);
  const read = vi.fn(async () => 'new');
  const ordinary = trackWorktreeSnapshotRead('deadline-case', read);
  await Promise.resolve();
  await Promise.resolve();
  expect(read).not.toHaveBeenCalled();
  drain({ retired: false, errors: [] });
  await expect(ordinary).resolves.toBe('new');
  expect(read).toHaveBeenCalledTimes(1);
});
