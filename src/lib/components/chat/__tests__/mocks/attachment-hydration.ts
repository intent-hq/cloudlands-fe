import type { store } from '$store/renderer/store';
import { chatReadSaga } from '$store/renderer/slices/chat-state/sagas/chat-read-saga';
import { installMockElectronBridge } from '../../../../../test/ct-mock-electron-bridge';

/** Hold the daemon response so browser tests can exercise loading and retry. */
export function createAttachmentHydrationFixture(onRequest: (params: unknown) => void) {
  let resolveRequest: ((value: unknown) => void) | undefined;
  let rejectRequest: ((error: Error) => void) | undefined;
  let blockId = 'legacy-image';
  installMockElectronBridge({
    'agent.getMessageBlock': (params) => {
      blockId = (params as { blockId: string }).blockId;
      onRequest(params);
      return new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
    },
  });
  return {
    startSagas: (appStore: Pick<typeof store, 'runSaga'>) => [appStore.runSaga(chatReadSaga)],
    finish: (data: string) =>
      resolveRequest?.({
        block: {
          id: blockId,
          type: 'image',
          mimeType: 'image/svg+xml',
          fileName: 'original.svg',
          data,
        },
      }),
    fail: () => rejectRequest?.(new Error('Attachment temporarily unavailable')),
  };
}
