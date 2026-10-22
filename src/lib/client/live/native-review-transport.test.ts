import { NativeReviewPreparationSchema } from '$shared/types/native-review';
import fixture from '$shared/types/__fixtures__/native-review-v1.json';
import { describe, it, expect, vi } from 'vitest';
import { createNativeReviewTransport } from './native-review-transport';
import type { NativeReviewSession } from '$shared/types/native-review-operation';
const root = { kind: 'primary' as const, workspaceId: 'ws' };
const input = {
  workspaceId: root.workspaceId,
  action: 'create-pr' as const,
  review: { root, choice: { kind: 'saved' as const } },
};
function session(): NativeReviewSession {
  return {
    preview: {
      root,
      ...fixture.prepare,
      reviewPreparation: NativeReviewPreparationSchema.parse({
        ...fixture.prepare.reviewPreparation,
        root,
      }),
      expiresAfterMs: 300000,
    },
    onRetired: vi.fn(() => vi.fn()),
    confirm: vi.fn(),
    reconcile: vi.fn(),
    release: vi.fn(async () => {}),
  };
}
describe('selection facade original session', () => {
  it('captures only the original root and never sends the renderer ownership descriptor', async () => {
    const s = session(),
      capture = vi.fn(async () => s),
      handler = vi.fn();
    const opened = await createNativeReviewTransport(capture).begin(
      { root, attemptId: 'view', admission: 'A', hostContext: 'A' },
      input,
      handler,
    );
    expect(capture).toHaveBeenCalledWith(input);
    expect(s.onRetired).toHaveBeenCalledWith(handler);
    await opened.release();
    await opened.release();
    expect(s.release).toHaveBeenCalledOnce();
  });
  it('refuses a returned root outside the original query and releases it', async () => {
    const s = session();
    s.preview.root = { ...root, workspaceId: 'other' };
    await expect(
      createNativeReviewTransport(async () => s).begin(
        { root, attemptId: 'view', admission: 'A', hostContext: 'A' },
        input,
        vi.fn(),
      ),
    ).rejects.toThrow();
    expect(s.release).toHaveBeenCalledOnce();
  });
  it('propagates unavailable instead of using an ordinary request or a new capture', async () => {
    const capture = vi.fn(async () => {
      throw new Error('forbidden');
    });
    await expect(
      createNativeReviewTransport(capture).begin(
        { root, attemptId: 'view', admission: 'A', hostContext: 'A' },
        input,
        vi.fn(),
      ),
    ).rejects.toThrow('forbidden');
    expect(capture).toHaveBeenCalledOnce();
  });
});

it('keeps the optional companion on the same facade session and coalesces without fresh prepare', async () => {
  const parent = session(),
    child = session(),
    capture = vi.fn(async () => parent);
  parent.prepareCompanion = vi.fn(async () => child);
  const opened = await createNativeReviewTransport(capture).begin(
    { root, attemptId: 'parent', admission: 'A', hostContext: 'A' },
    {
      ...input,
      action: 'commit',
      review: { ...input.review, targetBranch: 'trunk', companion: { kind: 'create-pr' } },
    },
    vi.fn(),
  );
  const first = opened.prepareCompanion!();
  expect(opened.prepareCompanion!()).toBe(first);
  expect(await first).toBe(child);
  expect(parent.prepareCompanion).toHaveBeenCalledOnce();
  expect(capture).toHaveBeenCalledOnce();
  await opened.release();
  await vi.waitFor(() => expect(child.release).toHaveBeenCalledOnce());
});
it('disposes a late companion after the owner releases and preserves old sessions without the method', async () => {
  const parent = session(),
    child = session();
  let finish!: (value: NativeReviewSession) => void;
  parent.prepareCompanion = vi.fn(
    () =>
      new Promise<NativeReviewSession>((resolve) => {
        finish = resolve;
      }),
  );
  const opened = await createNativeReviewTransport(async () => parent).begin(
    { root, attemptId: 'parent', admission: 'A', hostContext: 'A' },
    {
      ...input,
      action: 'commit',
      review: { ...input.review, targetBranch: 'trunk', companion: { kind: 'create-pr' } },
    },
    vi.fn(),
  );
  const pending = opened.prepareCompanion!();
  await Promise.resolve();
  await opened.release();
  finish(child);
  await expect(pending).rejects.toThrow();
  expect(child.release).toHaveBeenCalledOnce();
  const old = await createNativeReviewTransport(async () => session()).begin(
    { root, attemptId: 'old', admission: 'A', hostContext: 'A' },
    input,
    vi.fn(),
  );
  expect(old.prepareCompanion).toBeUndefined();
  await old.release();
});
