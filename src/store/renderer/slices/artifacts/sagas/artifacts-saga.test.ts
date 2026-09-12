import { beforeEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { artifactImagesRequested, artifactImageResolved } from '../artifacts-slice';
import { loadArtifactImages, artifactsSaga } from './artifacts-saga';
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  cached: {} as Record<string, { dataUrl: string }>,
}));
vi.mock('$features/artifacts/image-context', () => ({ readArtifactImage: mocks.read }));
vi.mock('$features/artifacts/service', () => ({}));
vi.mock('../artifacts-selectors', () => ({
  selectArtifactImages: {
    effect: function* () {
      return mocks.cached;
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cached = {};
});

it('loads workspace images as raster URLs and exposes failures', async () => {
  mocks.read
    .mockResolvedValueOnce({ data: 'AA==', mimeType: 'image/png' })
    .mockRejectedValueOnce(new Error('missing'));
  const dispatch = vi.fn();
  await runSaga(
    { dispatch },
    loadArtifactImages,
    artifactImagesRequested('w', ['good', 'missing']),
  ).toPromise();
  expect(dispatch).toHaveBeenCalledWith(
    artifactImageResolved('w', 'good', { failed: false, dataUrl: 'data:image/png;base64,AA==' }),
  );
  expect(dispatch).toHaveBeenCalledWith(artifactImageResolved('w', 'missing', { failed: true }));
  expect(mocks.read.mock.calls).toEqual([
    ['w', 'good'],
    ['w', 'missing'],
  ]);
});
it('reuses successful images and coalesces simultaneous reads', async () => {
  mocks.cached = { cached: { dataUrl: 'existing' } };
  let resolve!: (image: { data: string; mimeType: string }) => void;
  mocks.read.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const channel = stdChannel();
  const task = runSaga({ channel, dispatch: vi.fn() }, artifactsSaga);
  channel.put(artifactImagesRequested('w', ['cached', 'same']));
  channel.put(artifactImagesRequested('w', ['same']));
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.read).toHaveBeenCalledWith('w', 'same');
  resolve({ data: 'AA==', mimeType: 'image/png' });
  await Promise.resolve();
  task.cancel();
  await task.toPromise();
});
