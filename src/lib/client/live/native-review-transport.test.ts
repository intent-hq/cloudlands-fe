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
