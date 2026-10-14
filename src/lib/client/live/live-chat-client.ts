import { BackendChatClient } from './backend-chat-client';
import { backendRequest, onBackendNotification, onBackendReconnected } from './backend-transport';
import { reportStreamLifecycle } from '$lib/utils/stream-lifecycle-telemetry';

// Svelte/AppClient compatibility until that facade retires; React binds its own backend.
export class LiveChatClient extends BackendChatClient {
  constructor() {
    // The AppClient facade is constructed before transport capabilities are
    // installed. Resolve each capability at use, as the source binding did
    // before the shared chat implementation was extracted.
    super(
      {
        backendRequest: <T>(...args: Parameters<typeof backendRequest>) =>
          backendRequest<T>(...args),
        onBackendNotification: (...args) => onBackendNotification(...args),
        onBackendReconnected: (...args) => onBackendReconnected(...args),
      },
      reportStreamLifecycle,
    );
  }
}
export {
  ChatTranscriptReconciler,
  INITIAL_RETRY_DELAY_MS,
  SNAPSHOT_TIMEOUT_MS,
} from './backend-chat-client';
