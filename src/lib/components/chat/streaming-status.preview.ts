import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import StreamingStatus from './StreamingStatus.svelte';
import { STREAMING_STATUS_PREVIEW_FIXTURES } from './streaming-status.preview-fixtures';

export const preview = definePreview<ComponentProps<typeof StreamingStatus>>({
  id: 'streaming-status',
  title: 'Chat streaming status',
  defaultState: 'streaming',
  states: Object.fromEntries(
    Object.entries(STREAMING_STATUS_PREVIEW_FIXTURES).map(([name, props]) => [name, { props }]),
  ),
});

export default StreamingStatus;
