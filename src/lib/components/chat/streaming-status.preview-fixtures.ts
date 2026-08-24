import type { ComponentProps } from 'svelte';
import {
  PREVIEW_FIXTURE_IDS,
  PREVIEW_FIXTURE_TIMESTAMPS,
  definePreviewFixture,
} from '$lib/component-catalog/preview-fixtures';
import type StreamingStatus from './StreamingStatus.svelte';

type StreamingStatusProps = ComponentProps<typeof StreamingStatus>;

const statusEvent = definePreviewFixture({
  phase: 'streaming',
  message: 'Streaming a deterministic preview response…',
  level: 'info' as const,
  timestamp: Date.parse(PREVIEW_FIXTURE_TIMESTAMPS.updatedAt),
});

const statusProps = definePreviewFixture<StreamingStatusProps>({
  isStreaming: false,
  isProcessing: false,
  seed: PREVIEW_FIXTURE_IDS.agent,
  statusEvents: [],
});

const retry = () => undefined;
const retryWithModel = (_model: string) => undefined;

export const STREAMING_STATUS_PREVIEW_FIXTURES = Object.freeze({
  streaming: statusProps({
    isStreaming: true,
    receivedFirstChunk: true,
    streamingContentLength: 3840,
    statusEvents: [statusEvent()],
  }),
  waiting: statusProps({
    isProcessing: true,
    statusEvents: [
      statusEvent({
        phase: 'provider-queue',
        message: 'Waiting for provider capacity…',
        timestamp: Date.parse(PREVIEW_FIXTURE_TIMESTAMPS.lastActivity),
      }),
    ],
  }),
  error: statusProps({
    error: 'The response stream ended before the agent finished.',
    onRetry: retry,
  }),
  'model-unavailable': statusProps({
    modelUnavailable: {
      failedModel: 'preview:primary-model',
      nextAvailableModel: 'preview:fallback-model',
    },
    onRetryWithModel: retryWithModel,
  }),
  'long-content': statusProps({
    error:
      'The provider returned a long diagnostic message while finalizing the deterministic preview response. Expand this row to inspect wrapping, copy affordances, and narrow-width behavior without loading a conversation.',
    sessionCorrupted: true,
    onRetry: retry,
  }),
});
