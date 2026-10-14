import { BackendChatClient } from './backend-chat-client';
import { backendRequest, onBackendNotification, onBackendReconnected } from './backend-transport';
import { reportStreamLifecycle } from '$lib/utils/stream-lifecycle-telemetry';

// Existing Svelte/AppClient boundary; React binds the same implementation to its own backend.
export class LiveChatClient extends BackendChatClient {
  constructor() {
    super({ backendRequest, onBackendNotification, onBackendReconnected }, reportStreamLifecycle);
  }
}
export {
  ChatTranscriptReconciler,
  INITIAL_RETRY_DELAY_MS,
  SNAPSHOT_TIMEOUT_MS,
} from './backend-chat-client';
